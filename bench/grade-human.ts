// Hand-grade the fixed human sample one card at a time: keys 0 / 1 / 2, q to quit.
// Resumable: graded pairs are skipped on the next run.
import { emitKeypressEvents } from "node:readline";
import { companyCard } from "../src/lib/cards";
import { companyById } from "../src/lib/companies";
import { INTENT_LABEL, type Grade, type GradeRecord } from "../src/lib/domain";
import { appendJsonl, loadQueries, readJsonl } from "./lib";
import { HUMAN_GRADES, humanPairs, humanQueryIds } from "./pool";

if (!process.stdin.isTTY) {
  console.error("grade-human needs an interactive terminal");
  process.exit(2);
}

const queries = new Map(loadQueries("test").map((q) => [q.id, q]));
const done = new Set(readJsonl<GradeRecord>(HUMAN_GRADES).map((g) => `${g.queryId}:${g.companyId}`));
const todo = humanQueryIds().flatMap((qid) => humanPairs(qid).map((cid) => ({ q: queries.get(qid)!, cid }))).filter(({ q, cid }) => !done.has(`${q.id}:${cid}`));
if (!todo.length) {
  console.log(`all human pairs graded (${done.size}) in ${HUMAN_GRADES}`);
  process.exit(0);
}

emitKeypressEvents(process.stdin);
process.stdin.setRawMode(true);
const key = () => new Promise<string>((resolve) => process.stdin.once("keypress", (s: string | undefined, k: { name?: string; ctrl?: boolean }) => resolve(k?.ctrl && k.name === "c" ? "q" : (s ?? ""))));

for (const [n, { q, cid }] of todo.entries()) {
  console.clear();
  console.log(`${done.size + n + 1}/${done.size + todo.length}   ${INTENT_LABEL[q.intent]}\n`);
  console.log(`QUERY  ${q.text}\n`);
  console.log(companyCard(companyById(cid)));
  console.log("\n2 = exactly what they want   1 = related / partial   0 = not relevant   q = quit");
  let k = "";
  while (!["0", "1", "2", "q"].includes(k)) k = await key();
  if (k === "q") break;
  appendJsonl(HUMAN_GRADES, { queryId: q.id, companyId: cid, grade: Number(k) as Grade, by: "human", at: new Date().toISOString() } satisfies GradeRecord);
}
process.stdin.setRawMode(false);
process.exit(0);
