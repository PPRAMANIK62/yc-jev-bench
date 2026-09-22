// Does a reranker's agreement with the judge depend on where a candidate sits in the retrieval list?
// Per run file: Pearson r between the arm's score and the Opus grade over judged (query, company) pairs,
// pooled across queries, in bands of POSITION_BAND retrieval positions. --split dev|test (default test).
import { POSITION_BAND, type RerankRun } from "../src/lib/domain";
import { flag, loadCandidates, loadQueries, oneOf, readJsonl } from "./lib";
import { gradeMap, positionDecay, rerankFiles } from "./pool";

const split = oneOf("split", flag("split") ?? "test", ["dev", "test"] as const);
const queries = new Set(loadQueries(split).map((q) => q.id));
const candidates = loadCandidates();
const grades = gradeMap();

const rows = rerankFiles().flatMap((file) => {
  const runs = readJsonl<RerankRun>(file).filter((r) => queries.has(r.queryId));
  if (!runs.length || runs[0].arm === "none") return [];
  const d = positionDecay(runs, grades, candidates);
  const row: Record<string, string | number> = { run: file.replace(/^runs\/rerank-|\.jsonl$/g, ""), queries: d.queries };
  d.r.forEach((r, i) => {
    const band = `${i * POSITION_BAND + 1}-${(i + 1) * POSITION_BAND}`;
    row[`r ${band}`] = r.toFixed(2);
    row[`relevant ${band}`] = d.relevant[i].toFixed(2);
    row[`pairs ${band}`] = d.pairs[i];
  });
  return [row];
});

console.log(`${split} split; r = Pearson(score, Opus grade) over judged pairs by retrieval position; relevant = share graded >= 1`);
console.table(rows);
