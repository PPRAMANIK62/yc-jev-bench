import { readdirSync } from "node:fs";
import type { CompanyId, Grade, GradeRecord, QueryId, RerankRun } from "../src/lib/domain";
import { ndcgAt, recallAt, reciprocalRank } from "../src/lib/metrics";
import { orderByScores } from "../src/lib/rerankers";
import { loadCandidates, readJsonl } from "./lib";

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
