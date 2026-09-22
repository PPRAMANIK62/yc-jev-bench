// Picks each API arm's formulation on the dev split before the test set is touched. Every arm's dev runs
// are judged together before any pick, so each pilot reads the same grades. Writes data/pilot-<arm>.json,
// which chosenFormulation() reads.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { FORMULATIONS, type Formulation, type Pilot, type PilotArm, type PilotRow, type RerankRun } from "../src/lib/domain";
import { mean, percentile } from "../src/lib/metrics";
import { pilotFile } from "../src/lib/pilot";
import { loadCandidates, loadQueries, readJsonl, rerankFile } from "./lib";
import { gradeMap, queryQuality, rankedIds } from "./pool";

// Differences under this are noise on 20 queries; latency breaks the tie.
const NDCG_TIE = 0.01;

const SHAPE: Record<Formulation, { description: string; requestsPerSearch: number }> = {
  per_pair: { description: "one call per candidate; state holds the query and one company card", requestsPerSearch: 100 },
  fan_out: { description: "one call per search; state holds the query, 100 questions each carry a card", requestsPerSearch: 1 },
  batch_100: { description: "one prompt per search scoring all 100 cards", requestsPerSearch: 1 },
  batch_10: { description: "10 prompts per search sent at once, 10 cards each", requestsPerSearch: 10 },
};

function run(args: string[]) {
  const r = spawnSync("bun", args, { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`bun ${args.join(" ")} exited ${r.status}`);
}

const arms = Object.keys(FORMULATIONS) as PilotArm[];
for (const arm of arms) for (const f of FORMULATIONS[arm]) run(["bench/rerank.ts", "--arm", arm, "--formulation", f, "--split", "dev"]);
run(["bench/judge.ts", "--split", "dev"]);

const dev = new Set(loadQueries("dev").map((q) => q.id));
const candidates = loadCandidates();
const grades = gradeMap();

for (const arm of arms) {
  const rows: PilotRow[] = FORMULATIONS[arm].map((f: Formulation) => {
    const runs = readJsonl<RerankRun>(rerankFile(arm, f)).filter((r) => dev.has(r.queryId));
    const quality = runs.map((r) => queryQuality(rankedIds(r, candidates.get(r.queryId)!.candidateIds), grades.get(r.queryId))).filter((q) => q !== null);
    return {
      formulation: f,
      description: SHAPE[f].description,
      ndcg10: mean(quality.map((q) => q.ndcg10)),
      // the basis the report uses for the arm: API time when the arm reports it, wall time otherwise
      p50Ms: percentile(runs.map((r) => r.apiMs ?? r.wallMs), 50),
      costPer1kUsd: mean(runs.map((r) => r.costUsd ?? 0)) * 1000,
      requestsPerSearch: SHAPE[f].requestsPerSearch,
    };
  });
  const [best, other] = [...rows].sort((a, b) => b.ndcg10 - a.ndcg10);
  const chosen = best.ndcg10 - other.ndcg10 < NDCG_TIE && other.p50Ms < best.p50Ms ? other : best;
  const pilot: Pilot = { queries: dev.size, chosen: chosen.formulation, rows };
  writeFileSync(pilotFile(arm), JSON.stringify(pilot, null, 2) + "\n");
  console.log(`${arm}:`);
  console.table(rows.map(({ description, ...r }) => r));
  console.log(`chosen: ${chosen.formulation} → ${pilotFile(arm)}`);
}
