import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { mulberry32 } from "../src/lib/metrics";
import type { BenchQuery, CandidateSet, QueryId } from "../src/lib/domain";

export const QUERIES_FILE = "data/queries.jsonl";
export const CANDIDATES_FILE = "runs/candidates.jsonl";
export const SEED = 20260922;

export function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

export function appendJsonl(path: string, row: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}

export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function loadQueries(split?: "dev" | "test"): BenchQuery[] {
  const all = readJsonl<BenchQuery>(QUERIES_FILE);
  if (!all.length) throw new Error(`${QUERIES_FILE} is empty; run \`bun run bench:collect\``);
  return split ? all.filter((q) => q.split === split) : all;
}

export function loadCandidates(): Map<QueryId, CandidateSet> {
  return new Map(readJsonl<CandidateSet>(CANDIDATES_FILE).map((c) => [c.queryId, c]));
}

export function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function oneOf<T extends string>(name: string, value: string | undefined, allowed: readonly T[]): T {
  if (value === undefined || !allowed.includes(value as T)) {
    console.error(`--${name} must be one of ${allowed.join(", ")} (got ${value ?? "nothing"})`);
    process.exit(2);
  }
  return value as T;
}

// Round-robin across intents so `--limit N` samples every intent instead of the first one in the file.
export function interleaveByIntent(queries: BenchQuery[]): BenchQuery[] {
  const seen = new Map<string, number>();
  return queries
    .map((q) => {
      const n = seen.get(q.intent) ?? 0;
      seen.set(q.intent, n + 1);
      return { q, n };
    })
    .sort((a, b) => a.n - b.n)
    .map((x) => x.q);
}
