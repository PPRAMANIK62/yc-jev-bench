import { companyById } from "../src/lib/companies";
import { ARMS, FORMULATIONS, isPilotArm, type RerankRun } from "../src/lib/domain";
import { chosenFormulation } from "../src/lib/pilot";
import { RERANKERS } from "../src/lib/rerankers";
import { appendJsonl, flag, interleaveByIntent, loadCandidates, loadQueries, oneOf, readJsonl, rerankFile } from "./lib";
import { mapLimit } from "../src/lib/pool";
import { percentile } from "../src/lib/metrics";

const arm = oneOf("arm", flag("arm"), ARMS);
const split = flag("split") ? oneOf("split", flag("split"), ["dev", "test"] as const) : "test";
const limit = flag("limit") ? Number(flag("limit")) : Infinity;
const formulation = isPilotArm(arm) ? oneOf("formulation", flag("formulation") ?? chosenFormulation(arm), FORMULATIONS[arm]) : undefined;
// Haiku and Jev calls go over the network; Jev per_pair already fans out 16 requests per query, and
// src/lib/claude.ts caps Haiku calls in flight across queries.
const concurrency = arm === "haiku" ? 4 : arm === "jev" && formulation === "fan_out" ? 8 : 1;

const out = rerankFile(arm, formulation);
const done = new Set(readJsonl<RerankRun>(out).map((r) => r.queryId));
const candidates = loadCandidates();
const todo = interleaveByIntent(loadQueries(split)).filter((q) => !done.has(q.id)).slice(0, Math.max(0, limit - done.size));
const missing = todo.filter((q) => !candidates.has(q.id));
if (missing.length) throw new Error(`${missing.length} queries have no candidates; run \`bun run bench:retrieve\``);

const failures: string[] = [];
const ms: number[] = [];
const models = new Set<string>();
await mapLimit(todo, concurrency, async (q) => {
  const companies = candidates.get(q.id)!.candidateIds.map(companyById);
  try {
    const r = await RERANKERS[arm]({ query: q.text, companies, formulation });
    ms.push(r.cost.apiMs ?? r.cost.wallMs);
    models.add(r.model);
    const run: RerankRun = { queryId: q.id, arm, scores: r.scores, confidences: r.confidences, ...r.cost, at: new Date().toISOString() };
    appendJsonl(out, run);
    if (process.stdout.isTTY) process.stdout.write(`\r${arm}${formulation ? `/${formulation}` : ""}: ${ms.length}/${todo.length} (${r.model})`);
  } catch (e) {
    failures.push(`${q.id}: ${(e as Error).message}`);
  }
});
console.log(`\n${out}: ${ms.length} new, ${done.size} already done, ${failures.length} failed${models.size ? ` (model: ${[...models].join(", ")})` : ""}`);
for (const f of failures) console.log(`  failed ${f}`);
if (ms.length) console.log(`latency ms p50 ${percentile(ms, 50).toFixed(0)}, p99 ${percentile(ms, 99).toFixed(0)}`);
if (failures.length) process.exitCode = 1;
