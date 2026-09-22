import { buildBm25, bm25Scores, type Bm25Index } from "./bm25";
import { companyCard } from "./cards";
import { loadCompanies } from "./companies";
import type { Company, CompanyId, Intent, RetrievalMode } from "./domain";
import { EMBED_DIM, embedQuery, loadEmbeddingIndex, type EmbedDtype } from "./embed";

const RRF_K = 60;
const FUSE_DEPTH = 300;

const INTENT_FILTER: Record<Intent, (c: Company) => boolean> = {
  job: (c) => c.isHiring,
  open_source: (c) => c.isOpenSource,
  product: (c) => c.status === "Active",
  competitor: () => true,
};

let bm25: { index: Bm25Index; companies: Company[] } | null = null;
function getBm25() {
  if (!bm25) {
    const companies = loadCompanies();
    bm25 = { index: buildBm25(companies.map(companyCard)), companies };
  }
  return bm25;
}

function topByScore(rows: number[], score: (row: number) => number, depth: number): number[] {
  return rows
    .map((row) => ({ row, s: score(row) }))
    .sort((a, b) => b.s - a.s || a.row - b.row)
    .slice(0, depth)
    .map((r) => r.row);
}

export interface Retrieval {
  ids: CompanyId[];
  ms: number;
  mode: RetrievalMode;
}

export async function retrieve(query: string, opts: { intent: Intent | null; k?: number; dtype?: EmbedDtype }): Promise<Retrieval> {
  const t0 = performance.now();
  const k = opts.k ?? 100;
  const { index, companies } = getBm25();
  const emb = loadEmbeddingIndex();
  if (emb.ids.length !== companies.length || emb.ids.some((id, i) => id !== companies[i].id)) {
    throw new Error("data/index is stale for this snapshot; rerun `bun run bench:index`");
  }
  const keep = opts.intent ? INTENT_FILTER[opts.intent] : () => true;
  const rows = companies.flatMap((c, i) => (keep(c) ? [i] : []));

  const lexical = bm25Scores(index, query);
  // A model that will not load is the one failure retrieval survives: BM25 alone still ranks the
  // whole directory. The caller is told in the return value, and the reason goes to the server log.
  const q = await embedQuery(query, opts.dtype).catch((err: unknown) => {
    console.error("query embedding unavailable; retrieval is keyword-only", err);
    return null;
  });
  const cosine = (v: Float32Array, row: number) => {
    let dot = 0;
    const off = row * EMBED_DIM;
    for (let d = 0; d < EMBED_DIM; d++) dot += v[d] * emb.vectors[off + d];
    return dot;
  };

  const fused = new Map<number, number>();
  const addRanks = (ranked: number[]) => ranked.forEach((row, r) => fused.set(row, (fused.get(row) ?? 0) + 1 / (RRF_K + r + 1)));
  addRanks(topByScore(rows.filter((row) => lexical[row] > 0), (row) => lexical[row], FUSE_DEPTH));
  if (q) addRanks(topByScore(rows, (row) => cosine(q, row), FUSE_DEPTH));

  const ids = [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, k)
    .map(([row]) => companies[row].id);
  return { ids, ms: performance.now() - t0, mode: q ? "hybrid" : "keyword_only" };
}
