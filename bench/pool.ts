import { readdirSync } from "node:fs";
import { POSITION_BAND, type CompanyId, type Grade, type GradeRecord, type QueryId, type RerankRun } from "../src/lib/domain";
import { ndcgAt, pearson, recallAt, reciprocalRank } from "../src/lib/metrics";
import { orderByScores } from "../src/lib/rerankers";
import { SEED, hashSeed, interleaveByIntent, loadCandidates, loadQueries, readJsonl, seededShuffle } from "./lib";

export const POOL_DEPTH = 20;

export function rerankFiles(): string[] {
  return readdirSync("runs")
    .filter((f) => /^rerank-.+\.jsonl$/.test(f))
    .map((f) => `runs/${f}`)
    .sort();
}

// Every company that any present run put in its top POOL_DEPTH, per query.
export function pooledPairs(): Map<QueryId, Set<CompanyId>> {
  const candidates = loadCandidates();
  const pool = new Map<QueryId, Set<CompanyId>>();
  for (const file of rerankFiles()) {
    for (const run of readJsonl<RerankRun>(file)) {
      const ids = candidates.get(run.queryId)?.candidateIds;
      if (!ids) continue;
      const set = pool.get(run.queryId) ?? new Set();
      for (const id of rankedIds(run, ids).slice(0, POOL_DEPTH)) set.add(id);
      pool.set(run.queryId, set);
    }
  }
  return pool;
}

export const OPUS_GRADES = "data/grades.opus.jsonl";

export function gradeMap(file = OPUS_GRADES): Map<QueryId, Map<CompanyId, Grade>> {
  const out = new Map<QueryId, Map<CompanyId, Grade>>();
  for (const g of readJsonl<GradeRecord>(file)) {
    const m = out.get(g.queryId) ?? new Map();
    m.set(g.companyId, g.grade);
    out.set(g.queryId, m);
  }
  return out;
}

export function rankedIds(run: RerankRun, candidateIds: CompanyId[]): CompanyId[] {
  return orderByScores(candidateIds, run.scores);
}

// Per-query quality for one run, or null when the query has no relevant (grade >= 1) company judged.
export function queryQuality(ranked: CompanyId[], grades: Map<CompanyId, Grade> | undefined) {
  if (!grades || ![...grades.values()].some((g) => g >= 1)) return null;
  const all = [...grades.values()];
  const rg = ranked.map((id) => grades.get(id) ?? null);
  return { ndcg10: ndcgAt(rg, all), recall10: recallAt(rg, all), mrr: reciprocalRank(rg) };
}

export const HUMAN_GRADES = "data/grades.human.jsonl";
export const HUMAN_QUERY_COUNT = 10;
export const HUMAN_PER_QUERY = 20;

// Fixed sample for the human check: seeded shuffle of the test split, round-robin over intents.
export function humanQueryIds(): QueryId[] {
  return interleaveByIntent(seededShuffle(loadQueries("test"), SEED))
    .slice(0, HUMAN_QUERY_COUNT)
    .map((q) => q.id);
}

// The HUMAN_PER_QUERY companies with the best rank in any present run, blind-shuffled.
export function humanPairs(queryId: QueryId): CompanyId[] {
  const candidates = loadCandidates().get(queryId);
  if (!candidates) return [];
  const best = new Map<CompanyId, number>();
  for (const file of rerankFiles()) {
    const run = readJsonl<RerankRun>(file).find((r) => r.queryId === queryId);
    if (!run) continue;
    rankedIds(run, candidates.candidateIds).forEach((id, i) => best.set(id, Math.min(i, best.get(id) ?? Infinity)));
  }
  const top = [...best.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).slice(0, HUMAN_PER_QUERY).map(([id]) => id);
  return seededShuffle(top.sort((a, b) => a - b), hashSeed(queryId));
}

export function positionDecay(runs: RerankRun[], grades: Map<QueryId, Map<CompanyId, Grade>>, candidates: Map<QueryId, { candidateIds: CompanyId[] }>) {
  const bands: { scores: number[]; grades: number[] }[] = [];
  for (const run of runs) {
    candidates.get(run.queryId)!.candidateIds.forEach((id, i) => {
      const grade = grades.get(run.queryId)?.get(id);
      if (grade === undefined) return;
      const band = (bands[Math.floor(i / POSITION_BAND)] ??= { scores: [], grades: [] });
      band.scores.push(run.scores[i]);
      band.grades.push(grade);
    });
  }
  return {
    queries: runs.length,
    r: bands.map((b) => pearson(b.scores, b.grades)),
    relevant: bands.map((b) => b.grades.filter((g) => g >= 1).length / b.grades.length),
    pairs: bands.map((b) => b.grades.length),
  };
}
