import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { CompanyId } from "./domain";

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBED_DIM = 384;
// BGE v1.5 wants this instruction on short queries and nothing on passages.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export const INDEX_DIR = "data/index";
export const INDEX_VECTORS = join(INDEX_DIR, "embeddings.f32");
export const INDEX_IDS = join(INDEX_DIR, "ids.json");

// Vercel's filesystem is read-only, so the weights ship in the repo and the library is barred from
// fetching or caching any. Left on its default the library downloads into node_modules at the first
// search, which on Vercel fails with EACCES partway through a request. Off, a missing file fails
// immediately and retrieval degrades to keyword-only instead.
env.localModelPath = join(process.cwd(), "models");
env.allowRemoteModels = false;
env.useFSCache = false;
env.useBrowserCache = false;

// The only two quantizations anything here asks for. Narrower than the library's dtype union on
// purpose: a dtype the deployment does not carry should not typecheck.
export type EmbedDtype = "fp32" | "q8";
// What models/ carries and what the app embeds queries with.
export const APP_DTYPE: EmbedDtype = "q8";
// What data/index/embeddings.f32 holds. Documents and queries are embedded at different
// quantizations, which is a real and measured cost; bench/embed-drift.ts is the measurement.
export const INDEX_DTYPE: EmbedDtype = "fp32";

// Bench only. The fp32 weights the committed index was built with are 133 MB, past GitHub's 100 MiB
// per-file limit, so they are not vendored. Scripts that need them fetch and cache as usual; the app
// never calls this, so the server never reaches the network.
export function allowModelDownloads(): void {
  env.allowRemoteModels = true;
  env.useFSCache = true;
}

// A rejected promise stays in the map on purpose. A model missing from a deployment is missing for
// the life of the instance, so retrying would repeat a slow, doomed load on every later request.
const extractors = new Map<EmbedDtype, Promise<FeatureExtractionPipeline>>();
function getExtractor(dtype: EmbedDtype): Promise<FeatureExtractionPipeline> {
  let p = extractors.get(dtype);
  if (!p) extractors.set(dtype, (p = pipeline("feature-extraction", EMBED_MODEL, { dtype })));
  return p;
}

export async function embedPassages(texts: string[], dtype: EmbedDtype = INDEX_DTYPE): Promise<Float32Array> {
  const out = await (await getExtractor(dtype))(texts, { pooling: "cls", normalize: true });
  return out.data as Float32Array;
}

// Throws when the model cannot load. retrieve() turns that into keyword-only retrieval; bench
// scripts let it through, because a zeroed vector written into a frozen index is worse than a crash.
export async function embedQuery(query: string, dtype: EmbedDtype = APP_DTYPE): Promise<Float32Array> {
  return embedPassages([QUERY_PREFIX + query], dtype);
}

export interface EmbeddingIndex {
  ids: CompanyId[];
  vectors: Float32Array; // ids.length × EMBED_DIM, row-major, unit length
}

let index: EmbeddingIndex | null = null;
export function loadEmbeddingIndex(): EmbeddingIndex {
  if (index) return index;
  const root = process.cwd();
  if (!existsSync(join(root, INDEX_VECTORS))) throw new Error(`missing ${INDEX_VECTORS}; run \`bun run bench:index\``);
  const ids = JSON.parse(readFileSync(join(root, INDEX_IDS), "utf8")) as CompanyId[];
  const buf = readFileSync(join(root, INDEX_VECTORS));
  const vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  if (vectors.length !== ids.length * EMBED_DIM) throw new Error(`${INDEX_VECTORS} has ${vectors.length} floats, expected ${ids.length}×${EMBED_DIM}`);
  index = { ids, vectors };
  return index;
}
