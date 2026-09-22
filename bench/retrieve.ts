// Freezes the 100 candidates per query so every arm reranks the identical set.
// Retrieval filters use the query's TRUE intent, not a router's guess, so router mistakes
// cannot contaminate the reranker comparison. Routing is scored separately (bench/route.ts).
import type { CandidateSet } from "../src/lib/domain";
import { retrieve } from "../src/lib/retrieve";
import { CANDIDATES_FILE, appendJsonl, loadCandidates, loadQueries } from "./lib";
import { percentile } from "../src/lib/metrics";

const done = loadCandidates();
const todo = loadQueries().filter((q) => !done.has(q.id));
const ms: number[] = [];
for (const q of todo) {
  const r = await retrieve(q.text, { intent: q.intent, k: 100 });
  // The app degrades to BM25 when the embedding model is missing. Freezing that into the candidate
  // set would silently cap every arm, so here it is a crash instead.
  if (r.mode !== "hybrid") throw new Error(`retrieval fell back to ${r.mode}; fix the embedding model before freezing candidates`);
  ms.push(r.ms);
  appendJsonl(CANDIDATES_FILE, { queryId: q.id, candidateIds: r.ids } satisfies CandidateSet);
}
console.log(`retrieved ${todo.length} queries (${done.size} already done)`);
if (ms.length > 1) console.log(`retrieval ms: first ${ms[0].toFixed(0)} (cold), p50 ${percentile(ms.slice(1), 50).toFixed(1)}, p99 ${percentile(ms.slice(1), 99).toFixed(1)}`);
