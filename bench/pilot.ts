// Picks the Jev formulation on the dev split before the test set is touched. Writes data/jev-pilot.json (read by JEV_CHOSEN).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { JEV_FORMULATIONS, type JevFormulation, type JevPilotRow, type Results } from "../src/lib/domain";
import { JEV_PILOT_FILE } from "../src/lib/jev";
import { mean, percentile } from "../src/lib/metrics";
import { loadCandidates, loadQueries, readJsonl } from "./lib";
import { gradeMap, queryQuality, rankedIds } from "./pool";
import type { RerankRun } from "../src/lib/domain";

// Differences under this are noise on 20 queries; latency breaks the tie.
const NDCG_TIE = 0.01;

const DESCRIPTION: Record<JevFormulation, string> = {
  per_pair: "one call per candidate; state holds the query and one company card",
  fan_out: "one call per search; state holds the query, 100 questions each carry a card",
};
const REQUESTS: Record<JevFormulation, number> = { per_pair: 100, fan_out: 1 };

function run(args: string[]) {
  const r = spawnSync("bun", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`bun ${args.join(" ")} exited ${r.status}`);
}

for (const f of JEV_FORMULATIONS) run(["bench/rerank.ts", "--arm", "jev", "--formulation", f, "--split", "dev"]);
run(["bench/judge.ts", "--split", "dev"]);

const dev = loadQueries("dev");
const candidates = loadCandidates();
const grades = gradeMap();
const rows: JevPilotRow[] = JEV_FORMULATIONS.map((f) => {
  const runs = readJsonl<RerankRun>(`runs/rerank-jev-${f}.jsonl`).filter((r) => dev.some((q) => q.id === r.queryId));
  const quality = runs.map((r) => queryQuality(rankedIds(r, candidates.get(r.queryId)!.candidateIds), grades.get(r.queryId))).filter((q) => q !== null);
  return {
    formulation: f,
    description: DESCRIPTION[f],
    ndcg10: mean(quality.map((q) => q.ndcg10)),
    p50Ms: percentile(runs.map((r) => r.wallMs), 50),
    costPer1kUsd: mean(runs.map((r) => r.costUsd ?? 0)) * 1000,
    requestsPerSearch: REQUESTS[f],
  };
});
const [best, other] = [...rows].sort((a, b) => b.ndcg10 - a.ndcg10);
const chosen = best.ndcg10 - other.ndcg10 < NDCG_TIE && other.p50Ms < best.p50Ms ? other : best;
const pilot: NonNullable<Results["jevPilot"]> = { queries: dev.length, chosen: chosen.formulation, rows };
writeFileSync(JEV_PILOT_FILE, JSON.stringify(pilot, null, 2) + "\n");
console.table(rows.map(({ description, ...r }) => r));
console.log(`chosen: ${chosen.formulation} → ${JEV_PILOT_FILE}`);
