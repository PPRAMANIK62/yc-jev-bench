// Does a reranker's agreement with the judge depend on where a candidate sits in the retrieval list?
// Per run file: Pearson r between the arm's score and the Opus grade over judged (query, company) pairs,
// pooled across queries, in bands of 25 retrieval positions. --split dev|test (default test).
import type { RerankRun } from "../src/lib/domain";
import { flag, loadCandidates, loadQueries, oneOf, readJsonl } from "./lib";
import { gradeMap, rerankFiles } from "./pool";

const BAND = 25;
const BANDS = 4;

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

const split = oneOf("split", flag("split") ?? "test", ["dev", "test"] as const);
const queries = new Set(loadQueries(split).map((q) => q.id));
const candidates = loadCandidates();
const grades = gradeMap();

const rows = rerankFiles().flatMap((file) => {
  const runs = readJsonl<RerankRun>(file).filter((r) => queries.has(r.queryId));
  if (!runs.length || runs[0].arm === "none") return [];
  const bands = Array.from({ length: BANDS }, () => ({ scores: [] as number[], grades: [] as number[] }));
  for (const run of runs) {
    const g = grades.get(run.queryId);
    candidates.get(run.queryId)!.candidateIds.forEach((id, i) => {
      const grade = g?.get(id);
      if (grade === undefined || i >= BAND * BANDS) return;
      bands[Math.floor(i / BAND)].scores.push(run.scores[i]);
      bands[Math.floor(i / BAND)].grades.push(grade);
    });
  }
  const row: Record<string, string | number> = { run: file.replace(/^runs\/rerank-|\.jsonl$/g, ""), queries: runs.length };
  bands.forEach((b, i) => {
    const label = `${i * BAND}-${(i + 1) * BAND - 1}`;
    row[`r ${label}`] = pearson(b.scores, b.grades).toFixed(2);
    row[`relevant ${label}`] = (b.grades.filter((g) => g >= 1).length / b.grades.length).toFixed(2);
    row[`pairs ${label}`] = b.grades.length;
  });
  return [row];
});

console.log(`${split} split; r = Pearson(score, Opus grade) over judged pairs by retrieval position; relevant = share graded >= 1`);
console.table(rows);
