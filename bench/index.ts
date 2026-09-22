import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { companyCard } from "../src/lib/cards";
import { loadCompanies } from "../src/lib/companies";
import { EMBED_DIM, INDEX_DIR, INDEX_IDS, INDEX_VECTORS, embedPassages } from "../src/lib/embed";

const companies = loadCompanies();
const ids = companies.map((c) => c.id);

if (existsSync(INDEX_IDS) && existsSync(INDEX_VECTORS) && readFileSync(INDEX_IDS, "utf8") === JSON.stringify(ids)) {
  console.log(`index up to date: ${ids.length} companies`);
  process.exit(0);
}

mkdirSync(INDEX_DIR, { recursive: true });
const vectors = new Float32Array(ids.length * EMBED_DIM);
const BATCH = 64;
const t0 = performance.now();
for (let i = 0; i < companies.length; i += BATCH) {
  const chunk = companies.slice(i, i + BATCH).map(companyCard);
  vectors.set(await embedPassages(chunk), i * EMBED_DIM);
  if ((i / BATCH) % 10 === 0) process.stdout.write(`\r${i + chunk.length}/${companies.length}`);
}
writeFileSync(INDEX_VECTORS, Buffer.from(vectors.buffer));
writeFileSync(INDEX_IDS, JSON.stringify(ids));
console.log(`\nembedded ${ids.length} cards in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
