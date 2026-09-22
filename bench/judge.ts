// Opus grades pooled (query, company) pairs, blind to which arm surfaced them.
// --split dev|test limits to one split. --only-with <arm> limits test queries to those that arm has run on.
import { companyCard } from "../src/lib/cards";
import { companyById } from "../src/lib/companies";
import { OPUS, claudeJson, extractJson } from "../src/lib/claude";
import { ARMS, type BenchQuery, type CompanyId, type Grade, type GradeRecord, type Intent, type QueryId, type RerankRun } from "../src/lib/domain";
import { mapLimit } from "../src/lib/pool";
import { appendJsonl, flag, hashSeed, loadQueries, oneOf, readJsonl, seededShuffle } from "./lib";
import { HUMAN_GRADES, OPUS_GRADES, pooledPairs } from "./pool";

const PER_CALL = 20;

const INTENT_RUBRIC: Record<Intent, string> = {
  competitor: "The searcher described a product or problem. A good result is a company doing the same thing (a competitor or a company solving that same problem).",
  product: "The searcher wants a tool, app or service to use. A good result is a company whose product they could use for exactly that need.",
  job: "The searcher is an engineer looking for a job. A good result is a company that is hiring and whose work fits the person's skills (and location or remote preference, when given).",
  open_source: "The searcher wants open-source software to use, self-host or contribute to. A good result is an open-source company or project that fits what they asked for.",
};

export const JUDGE_SYSTEM = `You grade search results for a directory of YC startups.
You get a search query, what kind of search it is, and a numbered list of company cards.
Grade each company:
2 = exactly what the searcher wants
1 = related or a partial match
0 = not relevant
Judge only from the query and the card. Reply with only a JSON array like [{"i":1,"grade":2},{"i":2,"grade":0}], one entry per company.`;

function judgePrompt(q: BenchQuery, ids: CompanyId[]): string {
  const cards = ids.map((id, i) => `[${i + 1}]\n${companyCard(companyById(id))}`).join("\n\n");
  return `Query: ${q.text}\nKind of search: ${INTENT_RUBRIC[q.intent]}\n\nCompanies:\n\n${cards}`;
}

function parseGrades(text: string, n: number): Grade[] {
  const arr = extractJson(text);
  if (!Array.isArray(arr)) throw new Error("judge reply is not an array");
  const grades = new Array<Grade | undefined>(n);
  for (const row of arr as { i: number; grade: number }[]) {
    if (!Number.isInteger(row.i) || row.i < 1 || row.i > n || ![0, 1, 2].includes(row.grade)) throw new Error(`bad judge row ${JSON.stringify(row)}`);
    grades[row.i - 1] = row.grade as Grade;
  }
  if (grades.some((g) => g === undefined)) throw new Error(`judge graded ${arr.length} of ${n}`);
  return grades as Grade[];
}

const split = flag("split") ? oneOf("split", flag("split"), ["dev", "test"] as const) : null;
const onlyWith = flag("only-with") ? oneOf("only-with", flag("only-with"), ARMS) : null;
// Queries a human has graded are always in scope, so judge-vs-human agreement has pairs to compare.
const scope = onlyWith
  ? new Set([...readJsonl<RerankRun>(`runs/rerank-${onlyWith}.jsonl`), ...readJsonl<GradeRecord>(HUMAN_GRADES)].map((r) => r.queryId))
  : null;
const queries = new Map(loadQueries().map((q) => [q.id, q]));
const graded = new Set(readJsonl<GradeRecord>(OPUS_GRADES).map((g) => `${g.queryId}:${g.companyId}`));

const jobs: { q: BenchQuery; ids: CompanyId[] }[] = [];
for (const [queryId, ids] of pooledPairs()) {
  const q = queries.get(queryId as QueryId);
  if (!q || (split && q.split !== split) || (q.split === "test" && scope && !scope.has(q.id))) continue;
  const todo = seededShuffle([...ids].filter((id) => !graded.has(`${q.id}:${id}`)).sort((a, b) => a - b), hashSeed(q.id));
  for (let i = 0; i < todo.length; i += PER_CALL) jobs.push({ q, ids: todo.slice(i, i + PER_CALL) });
}
const pairs = jobs.reduce((s, j) => s + j.ids.length, 0);
console.log(`judging ${pairs} ungraded pairs in ${jobs.length} calls (${graded.size} already graded)`);

let costUsd = 0;
const failures: string[] = [];
await mapLimit(jobs, 4, async ({ q, ids }) => {
  try {
    const r = await claudeJson(OPUS, JUDGE_SYSTEM, judgePrompt(q, ids), (t) => parseGrades(t, ids.length));
    costUsd += r.totalCostUsd;
    const at = new Date().toISOString();
    r.value.forEach((grade, i) => appendJsonl(OPUS_GRADES, { queryId: q.id, companyId: ids[i], grade, by: "opus", at } satisfies GradeRecord));
  } catch (e) {
    failures.push(`${q.id}: ${(e as Error).message}`);
  }
});
console.log(`done: ${jobs.length - failures.length} calls, $${costUsd.toFixed(2)} Claude Code total_cost_usd, ${failures.length} failed`);
for (const f of failures) console.log(`  failed ${f}`);
if (failures.length) process.exitCode = 1;
