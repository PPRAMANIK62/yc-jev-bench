import { HAIKU, claudeJson } from "../src/lib/claude";
import { INTENTS, ROUTERS, type CallCost, type Intent, type RouteRun } from "../src/lib/domain";
import { jevRoute } from "../src/lib/jev";
import { mapLimit } from "../src/lib/pool";
import { percentile } from "../src/lib/metrics";
import { appendJsonl, flag, interleaveByIntent, loadQueries, oneOf, readJsonl } from "./lib";

export const HAIKU_ROUTE_SYSTEM = `You route search queries typed into a directory of YC startups.
Answer with exactly one word from this list and nothing else:
competitor: the searcher describes a product or problem and wants companies that do the same thing
product: the searcher wants a tool, app or service they could use
job: the searcher wants a startup to work at that is hiring people with their skills
open_source: the searcher wants open-source software to use or contribute to`;

type Routed = { predicted: Intent; probabilities: Record<Intent, number> | null; confidence: number | null; cost: CallCost };

const ROUTE: Record<(typeof ROUTERS)[number], (query: string) => Promise<Routed>> = {
  haiku: async (query) => {
    const r = await claudeJson(HAIKU, HAIKU_ROUTE_SYSTEM, `Search query: ${query}\n\nWhich kind of search is this? One word.`, (text) => {
      const word = text.trim().toLowerCase().replace(/[^a-z_]/g, "");
      if (!INTENTS.includes(word as Intent)) throw new Error(`haiku router answered ${JSON.stringify(text.slice(0, 80))}`);
      return word as Intent;
    });
    return { predicted: r.value, probabilities: null, confidence: null, cost: r.cost };
  },
  jev: async (query) => {
    const r = await jevRoute(query);
    return { predicted: r.decision.intent, probabilities: r.decision.probabilities, confidence: r.decision.confidence, cost: r.cost };
  },
};

const router = oneOf("router", flag("router"), ROUTERS);
const split = flag("split") ? oneOf("split", flag("split"), ["dev", "test"] as const) : "test";
const limit = flag("limit") ? Number(flag("limit")) : Infinity;
const out = `runs/route-${router}.jsonl`;
const done = new Set(readJsonl<RouteRun>(out).map((r) => r.queryId));
const todo = interleaveByIntent(loadQueries(split)).filter((q) => !done.has(q.id)).slice(0, Math.max(0, limit - done.size));

const failures: string[] = [];
const ms: number[] = [];
let correct = 0;
await mapLimit(todo, router === "haiku" ? 4 : 8, async (q) => {
  try {
    const r = await ROUTE[router](q.text);
    ms.push(r.cost.apiMs ?? r.cost.wallMs);
    if (r.predicted === q.intent) correct++;
    const { cost, ...rest } = r;
    appendJsonl(out, { queryId: q.id, router, ...rest, ...cost, at: new Date().toISOString() } satisfies RouteRun);
  } catch (e) {
    failures.push(`${q.id}: ${(e as Error).message}`);
  }
});
console.log(`${out}: ${ms.length} new (${correct} correct), ${done.size} already done, ${failures.length} failed`);
for (const f of failures) console.log(`  failed ${f}`);
if (ms.length) console.log(`latency ms p50 ${percentile(ms, 50).toFixed(0)}, p99 ${percentile(ms, 99).toFixed(0)}`);
if (failures.length) process.exitCode = 1;
