// The committed index (data/index/embeddings.f32) holds fp32 document vectors. The app ships the
// q8 weights, because the fp32 file is 133 MB and a Vercel function has 250 MB for everything.
// So production embeds a query at one quantization and compares it to documents embedded at
// another. This measures what that costs, on the same 200 test queries the benchmark reports.
//
// Two numbers per query, because they answer different questions. Dense-only is the unmixed drift
// in the embedding itself. Hybrid is what a searcher actually gets, after BM25 fuses in and damps it.
import { allowModelDownloads, embedQuery, loadEmbeddingIndex, APP_DTYPE, EMBED_DIM, INDEX_DTYPE } from "../src/lib/embed";
import { retrieve } from "../src/lib/retrieve";
import { percentile } from "../src/lib/metrics";
import { loadQueries } from "./lib";
import type { CompanyId } from "../src/lib/domain";

// The fp32 weights are not vendored, so this script fetches them like any other bench step.
allowModelDownloads();

const K = 100;
const TOP = 10;
const SPLIT = "test";

const overlap = (a: readonly CompanyId[], b: readonly CompanyId[]) => {
  const set = new Set(b);
  return a.filter((id) => set.has(id)).length / Math.max(1, a.length);
};

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < EMBED_DIM; i++) s += a[i] * b[i];
  return s;
};

// The dense arm of retrieve(), run alone so the drift is not diluted by BM25.
function denseTop(vectors: Float32Array, q: Float32Array, ids: CompanyId[], k: number): CompanyId[] {
  return ids
    .map((id, row) => {
      let s = 0;
      const off = row * EMBED_DIM;
      for (let d = 0; d < EMBED_DIM; d++) s += q[d] * vectors[off + d];
      return { id, s };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((r) => r.id);
}

const queries = loadQueries(SPLIT);
const { ids: indexIds, vectors } = loadEmbeddingIndex();

const cos: number[] = [];
const dense100: number[] = [];
const hybrid100: number[] = [];
const hybrid10: number[] = [];
let top10Changed = 0;
let top1Changed = 0;

for (const q of queries) {
  const a = await embedQuery(q.text, INDEX_DTYPE);
  const b = await embedQuery(q.text, APP_DTYPE);
  cos.push(dot(a, b));
  dense100.push(overlap(denseTop(vectors, a, indexIds, K), denseTop(vectors, b, indexIds, K)));

  const ra = await retrieve(q.text, { intent: q.intent, k: K, dtype: INDEX_DTYPE });
  const rb = await retrieve(q.text, { intent: q.intent, k: K, dtype: APP_DTYPE });
  if (ra.mode !== "hybrid" || rb.mode !== "hybrid") {
    throw new Error(`retrieval ran ${ra.mode}/${rb.mode}; two keyword-only runs agree perfectly and would report zero drift`);
  }
  const top = overlap(ra.ids.slice(0, TOP), rb.ids.slice(0, TOP));
  hybrid100.push(overlap(ra.ids, rb.ids));
  hybrid10.push(top);
  if (top < 1) top10Changed++;
  if (ra.ids[0] !== rb.ids[0]) top1Changed++;
}

const row = (label: string, xs: number[], digits = 3) =>
  `${label.padEnd(34)} ${percentile(xs, 50).toFixed(digits).padStart(8)} ${percentile(xs, 5).toFixed(digits).padStart(8)} ${Math.min(...xs).toFixed(digits).padStart(8)}`;

const n = queries.length;
console.log(`${INDEX_DTYPE} (index) vs ${APP_DTYPE} (app) query embeddings, ${n} ${SPLIT} queries, against the committed ${INDEX_DTYPE} index\n`);
console.log(`${"".padEnd(34)} ${"median".padStart(8)} ${"p5".padStart(8)} ${"worst".padStart(8)}`);
console.log(row(`cosine(${INDEX_DTYPE} query, ${APP_DTYPE} query)`, cos, 4));
console.log(row(`dense-only top-${K} overlap`, dense100));
console.log(row(`hybrid top-${K} overlap`, hybrid100));
console.log(row(`hybrid top-${TOP} overlap`, hybrid10));
console.log(`\ntop-${TOP} changed at all:  ${top10Changed}/${n} queries (${((100 * top10Changed) / n).toFixed(1)}%)`);
console.log(`rank 1 changed:        ${top1Changed}/${n} queries (${((100 * top1Changed) / n).toFixed(1)}%)`);
console.log(`\ngate: ship ${APP_DTYPE} when the median hybrid top-${K} overlap is at least 0.95.`);
