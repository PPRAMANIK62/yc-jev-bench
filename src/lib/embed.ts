import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import type { CompanyId } from "./domain";

export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBED_DIM = 384;
// BGE v1.5 wants this instruction on short queries and nothing on passages.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

export const INDEX_DIR = "data/index";
export const INDEX_VECTORS = join(INDEX_DIR, "embeddings.f32");
export const INDEX_IDS = join(INDEX_DIR, "ids.json");

let extractor: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor() {
  extractor ??= pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
  return extractor;
}

export async function embedPassages(texts: string[]): Promise<Float32Array> {
  const out = await (await getExtractor())(texts, { pooling: "cls", normalize: true });
  return out.data as Float32Array;
}

export async function embedQuery(query: string): Promise<Float32Array> {
  return embedPassages([QUERY_PREFIX + query]);
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
