// Turns runs/ and data/grades.* into src/generated/results.json, the only thing the report reads.
// Arms are compared on the test queries every present arm has run (and routers likewise), so a
// partially run arm narrows the comparison instead of skewing it. Full-coverage numbers are logged.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { companyById, SNAPSHOT } from "../src/lib/companies";
import {
  ARMS,
  INTENTS,
  ROUTERS,
  type ArmId,
  type ArmResult,
  type BenchQuery,
  type CompanyId,
  type ExplorerCompany,
  type ExplorerQuery,
  type Grade,
  type GradeRecord,
  type HypothesisResult,
  type Intent,
  type QualityMetrics,
  type QueryId,
  type RerankRun,
  type Results,
  type RouteRun,
  type RouterId,
  type RouterResult,
  type SpeedCost,
} from "../src/lib/domain";
import { JEV_CHOSEN, JEV_PILOT_FILE } from "../src/lib/jev";
import { bootstrap, calibrationBins, cohenKappa, confusionMatrix, mean, percentile } from "../src/lib/metrics";
import { loadCandidates, loadQueries, readJsonl } from "./lib";
import { OPUS_GRADES, gradeMap, queryQuality, rankedIds } from "./pool";

const OUT = "src/generated/results.json";
const HUMAN_GRADES = "data/grades.human.jsonl";
// Below this many graded queries a quality hypothesis stays pending rather than being called on noise.
const MIN_QUERIES = 20;

const test = loadQueries("test");
const byId = new Map(test.map((q) => [q.id, q]));
const candidates = loadCandidates();
const grades = gradeMap();

const armFile = (arm: ArmId) => (arm === "jev" ? `runs/rerank-jev-${JEV_CHOSEN}.jsonl` : `runs/rerank-${arm}.jsonl`);
const armRuns = new Map<ArmId, Map<QueryId, RerankRun>>();
for (const arm of ARMS) {
  const runs = readJsonl<RerankRun>(armFile(arm)).filter((r) => byId.has(r.queryId));
  if (runs.length) armRuns.set(arm, new Map(runs.map((r) => [r.queryId, r])));
}
const routeRuns = new Map<RouterId, Map<QueryId, RouteRun>>();
for (const router of ROUTERS) {
  const runs = readJsonl<RouteRun>(`runs/route-${router}.jsonl`).filter((r) => byId.has(r.queryId));
  if (runs.length) routeRuns.set(router, new Map(runs.map((r) => [r.queryId, r])));
}

function intersect(sets: Iterable<QueryId>[]): QueryId[] {
  const [first, ...rest] = [...sets].map((s) => new Set(s));
  return first ? [...first].filter((id) => rest.every((s) => s.has(id))) : [];
}

const speed = (runs: { wallMs: number; apiMs: number | null; costUsd: number | null }[]): SpeedCost => {
  const api = runs.every((r) => r.apiMs !== null);
  const ms = runs.map((r) => (api ? r.apiMs! : r.wallMs));
  const costs = runs.map((r) => r.costUsd);
  return {
    p50Ms: percentile(ms, 50),
    p99Ms: percentile(ms, 99),
    costPer1kUsd: costs.every((c) => c === null) ? null : mean(costs.map((c) => c ?? 0)) * 1000,
    latencyBasis: api ? "api" : "wall",
  };
};

// ------------------------------------------------------------------ arms

const commonArmQueries = intersect([...armRuns.values()].map((m) => m.keys()));

function quality(arm: ArmId, queries: BenchQuery[]): QualityMetrics | null {
  const rows = queries
    .map((q) => queryQuality(rankedIds(armRuns.get(arm)!.get(q.id)!, candidates.get(q.id)!.candidateIds), grades.get(q.id)))
    .filter((r) => r !== null);
  if (!rows.length) return null;
  const recall = rows.map((r) => r.recall10).filter((r): r is number => r !== null);
  return { ndcg10: bootstrap(rows.map((r) => r.ndcg10)), recall10: bootstrap(recall), mrr: bootstrap(rows.map((r) => r.mrr)), n: rows.length };
}

function knownRank(arm: ArmId, q: BenchQuery): number | null {
  const ranked = rankedIds(armRuns.get(arm)!.get(q.id)!, candidates.get(q.id)!.candidateIds);
  const i = ranked.indexOf(q.knownAnswer!);
  return i < 0 ? null : i + 1;
}

const common = commonArmQueries.map((id) => byId.get(id)!);
const arms: ArmResult[] = [];
for (const arm of armRuns.keys()) {
  const overall = quality(arm, common);
  const byIntent: Partial<Record<Intent, QualityMetrics>> = {};
  for (const intent of INTENTS) {
    const m = quality(arm, common.filter((q) => q.intent === intent));
    if (m) byIntent[intent] = m;
  }
  arms.push({
    arm,
    overall: overall ?? { ndcg10: bootstrap([]), recall10: bootstrap([]), mrr: bootstrap([]), n: 0 },
    byIntent,
    speed: speed([...armRuns.get(arm)!.values()]),
    knownItemRanks: common.filter((q) => q.knownAnswer !== null).map((q) => knownRank(arm, q)),
  });
  const own = [...armRuns.get(arm)!.keys()].map((id) => byId.get(id)!).filter((q) => q.knownAnswer !== null);
  const ranks = own.map((q) => knownRank(arm, q));
  const found = ranks.filter((r): r is number => r !== null);
  console.log(
    `${arm.padEnd(6)} ${armRuns.get(arm)!.size} test queries run; known item (all ${own.length} Launch HN): ` +
      `median rank ${found.length ? percentile(found, 50) : "-"}, top-10 ${found.filter((r) => r <= 10).length}, outside 100: ${ranks.length - found.length}`,
  );
}

// ------------------------------------------------------------------ routers

const commonRouteQueries = intersect([...routeRuns.values()].map((m) => m.keys()));
const routers: RouterResult[] = [...routeRuns.keys()].map((router) => {
  const runs = commonRouteQueries.map((id) => routeRuns.get(router)!.get(id)!);
  const pairs = runs.map((r) => ({ actual: byId.get(r.queryId)!.intent, predicted: r.predicted }));
  const all = [...routeRuns.get(router)!.values()];
  console.log(`router ${router}: ${all.filter((r) => r.predicted === byId.get(r.queryId)!.intent).length}/${all.length} correct on all its runs`);
  return {
    router,
    accuracy: mean(pairs.map((p) => (p.actual === p.predicted ? 1 : 0))),
    n: runs.length,
    confusion: confusionMatrix(pairs),
    speed: speed([...routeRuns.get(router)!.values()]),
  };
});

const jevRoutes = [...(routeRuns.get("jev")?.values() ?? [])].filter((r) => r.confidence !== null);
const calibration = jevRoutes.length
  ? calibrationBins(jevRoutes.map((r) => ({ confidence: r.confidence!, correct: r.predicted === byId.get(r.queryId)!.intent })))
  : null;

// ------------------------------------------------------------------ judge agreement

let judgeAgreement: Results["judgeAgreement"] = null;
const human = readJsonl<GradeRecord>(HUMAN_GRADES);
if (human.length) {
  const pairs = human.flatMap((h) => {
    const o = grades.get(h.queryId)?.get(h.companyId);
    return o === undefined ? [] : [[o, h.grade] as [Grade, Grade]];
  });
  judgeAgreement = {
    n: pairs.length,
    exact: mean(pairs.map(([a, b]) => (a === b ? 1 : 0))),
    within1: mean(pairs.map(([a, b]) => (Math.abs(a - b) <= 1 ? 1 : 0))),
    kappa: cohenKappa(pairs),
  };
}

// ------------------------------------------------------------------ hypotheses

const arm = (id: ArmId) => arms.find((a) => a.arm === id);
const router = (id: RouterId) => routers.find((r) => r.router === id);
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const f2 = (x: number) => x.toFixed(2);

function qualityHypothesis(id: "H1" | "H4", statement: string, other: ArmId, holds: (jev: number, o: number) => boolean, ratio: boolean): HypothesisResult {
  const j = arm("jev");
  const o = arm(other);
  if (!j || !o) return { id, statement, verdict: "pending", evidence: `needs both jev and ${other} runs` };
  const n = Math.min(j.overall.n, o.overall.n);
  if (n < MIN_QUERIES) return { id, statement, verdict: "pending", evidence: `${n} graded queries in common, need ${MIN_QUERIES}` };
  const [a, b] = [j.overall.ndcg10.mean, o.overall.ndcg10.mean];
  return {
    id,
    statement,
    verdict: holds(a, b) ? "supported" : "rejected",
    evidence: `nDCG@10 Jev ${f2(a)} vs ${other} ${f2(b)}${ratio ? ` (${pct(a / b)})` : ""}, n=${n}`,
  };
}

const hypotheses: HypothesisResult[] = [
  qualityHypothesis("H1", "Jev reaches at least 90% of Claude Haiku's nDCG@10 as a reranker.", "haiku", (j, h) => j >= 0.9 * h, true),
  (() => {
    const statement = "Jev's p50 latency for 100 candidates is under 10% of Haiku's.";
    const j = arm("jev");
    const h = arm("haiku");
    if (!j || !h) return { id: "H2", statement, verdict: "pending", evidence: "needs both jev and haiku runs" } as HypothesisResult;
    const r = j.speed.p50Ms / h.speed.p50Ms;
    return {
      id: "H2",
      statement,
      verdict: r < 0.1 ? "supported" : "rejected",
      evidence: `p50 Jev ${j.speed.p50Ms.toFixed(0)} ms (${j.speed.latencyBasis}) vs Haiku ${h.speed.p50Ms.toFixed(0)} ms (${h.speed.latencyBasis}), ${pct(r)}`,
    } as HypothesisResult;
  })(),
  (() => {
    const statement = "Jev matches Haiku within 3 points of accuracy on intent routing.";
    const j = router("jev");
    const h = router("haiku");
    if (!j || !h) return { id: "H3", statement, verdict: "pending", evidence: "needs both routers" } as HypothesisResult;
    if (j.n < MIN_QUERIES) return { id: "H3", statement, verdict: "pending", evidence: `${j.n} queries in common, need ${MIN_QUERIES}` } as HypothesisResult;
    return {
      id: "H3",
      statement,
      verdict: Math.abs(j.accuracy - h.accuracy) <= 0.03 ? "supported" : "rejected",
      evidence: `accuracy Jev ${pct(j.accuracy)} vs Haiku ${pct(h.accuracy)}, n=${j.n}`,
    } as HypothesisResult;
  })(),
  qualityHypothesis("H4", "Jev beats the open-source cross-encoder on accuracy.", "bge", (j, b) => j > b, false),
];

// ------------------------------------------------------------------ explorer

const explorerCompanies: Record<number, ExplorerCompany> = {};
const explorerQueries: ExplorerQuery[] = test
  .filter((q) => [...armRuns.values()].some((m) => m.has(q.id)))
  .map((q) => {
    const rankings: ExplorerQuery["rankings"] = {};
    for (const [a, runs] of armRuns) {
      const run = runs.get(q.id);
      if (!run) continue;
      rankings[a] = rankedIds(run, candidates.get(q.id)!.candidateIds)
        .slice(0, 10)
        .map((id: CompanyId) => {
          const c = companyById(id);
          explorerCompanies[id] = { id, name: c.name, oneLiner: c.oneLiner, batchShort: c.batchShort };
          return { id, grade: grades.get(q.id)?.get(id) ?? null };
        });
    }
    return { id: q.id, text: q.text, intent: q.intent, sourceUrl: q.source.url, knownAnswer: q.knownAnswer, rankings };
  });
for (const q of explorerQueries) {
  if (q.knownAnswer === null) continue;
  const c = companyById(q.knownAnswer);
  explorerCompanies[c.id] = { id: c.id, name: c.name, oneLiner: c.oneLiner, batchShort: c.batchShort };
}

// ------------------------------------------------------------------ write

const results: Results = {
  generatedAt: new Date().toISOString(),
  jevPilot: existsSync(JEV_PILOT_FILE) ? (JSON.parse(readFileSync(JEV_PILOT_FILE, "utf8")) as Results["jevPilot"]) : null,
  snapshot: SNAPSHOT,
  synthetic: false,
  queryCounts: Object.fromEntries(INTENTS.map((i) => [i, test.filter((q) => q.intent === i).length])) as Record<Intent, number>,
  gradedPairs: readJsonl<GradeRecord>(OPUS_GRADES).length,
  judgeAgreement,
  arms,
  routers,
  calibration,
  hypotheses,
  explorer: { queries: explorerQueries, companies: explorerCompanies },
};

// generatedAt aside, an unchanged input set produces an identical file, so reruns do not dirty git.
const body = (r: Results) => JSON.stringify({ ...r, generatedAt: "" }, null, 2);
if (existsSync(OUT) && body(JSON.parse(readFileSync(OUT, "utf8"))) === body(results)) {
  console.log(`${OUT} unchanged`);
} else {
  writeFileSync(OUT, JSON.stringify(results, null, 2) + "\n");
  console.log(`wrote ${OUT}`);
}
console.log(`arms compared on ${common.length} common test queries; routers on ${commonRouteQueries.length}`);
for (const a of arms) console.log(`  ${a.arm.padEnd(6)} nDCG@10 ${f2(a.overall.ndcg10.mean)} [${f2(a.overall.ndcg10.lo)}, ${f2(a.overall.ndcg10.hi)}] n=${a.overall.n}  p50 ${a.speed.p50Ms.toFixed(0)} ms  $/1k ${a.speed.costPer1kUsd?.toFixed(3) ?? "-"}`);
for (const r of routers) console.log(`  router ${r.router} accuracy ${pct(r.accuracy)} n=${r.n} p50 ${r.speed.p50Ms.toFixed(0)} ms`);
for (const h of hypotheses) console.log(`  ${h.id} ${h.verdict}: ${h.evidence}`);
