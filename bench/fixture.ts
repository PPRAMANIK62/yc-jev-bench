// Synthetic results for UI development. Numbers are deliberately round so nobody mistakes them for data.
import { writeFileSync } from "node:fs";
import { loadCompanies, SNAPSHOT } from "../src/lib/companies";
import {
  ARMS,
  INTENTS,
  type ArmId,
  type ArmResult,
  type CompanyId,
  type ExplorerCompany,
  type ExplorerQuery,
  type Grade,
  type Intent,
  type QualityMetrics,
  type QueryId,
  type Results,
  type RouterResult,
} from "../src/lib/domain";

const ARM_NDCG: Record<ArmId, number> = { none: 0.4, bge: 0.5, haiku: 0.7, jev: 0.6 };
const ARM_P50: Record<ArmId, number> = { none: 0, bge: 2000, haiku: 8000, jev: 500 };
const ARM_COST: Record<ArmId, number | null> = { none: null, bge: null, haiku: 20, jev: 0.5 };
const INTENT_SHIFT: Record<Intent, number> = { competitor: 0.1, product: 0, job: -0.1, open_source: -0.2 };

const interval = (mean: number) => ({ mean, lo: +(mean - 0.05).toFixed(2), hi: +(mean + 0.05).toFixed(2) });
const quality = (ndcg: number, n: number): QualityMetrics => ({
  ndcg10: interval(ndcg),
  recall10: interval(+(ndcg - 0.1).toFixed(2)),
  mrr: interval(+(ndcg + 0.1).toFixed(2)),
  n,
});

const companies = loadCompanies().filter((c) => c.status === "Active").slice(0, 400);
const QUERIES: [Intent, string][] = [
  ["competitor", "who else does AI bookkeeping for small agencies"],
  ["competitor", "a company that helps restaurants manage inventory with computer vision"],
  ["product", "is there a tool to catch flaky tests in CI"],
  ["product", "alternative to Zapier for internal workflows"],
  ["job", "startups hiring engineers who know Go, Kubernetes, Postgres, AWS, remote-friendly"],
  ["job", "startups hiring engineers who know Python, PyTorch, CUDA, C++, in San Francisco"],
  ["open_source", "open-source YC projects I could contribute to in Rust"],
  ["open_source", "open source observability tools"],
];

const explorerCompanies: Record<number, ExplorerCompany> = {};
const queries: ExplorerQuery[] = QUERIES.map(([intent, text], qi) => {
  const rankings: Partial<Record<ArmId, { id: CompanyId; grade: Grade | null }[]>> = {};
  for (const [ai, arm] of ARMS.entries()) {
    rankings[arm] = Array.from({ length: 10 }, (_, r) => {
      const c = companies[(qi * 37 + ai * 5 + r * 3) % companies.length];
      explorerCompanies[c.id] = { id: c.id, name: c.name, oneLiner: c.oneLiner, batchShort: c.batchShort };
      return { id: c.id, grade: r === 9 ? null : (((r + ai) % 3) as Grade) };
    });
  }
  const known = intent === "competitor" ? rankings.haiku![0].id : null;
  return {
    id: `fx-${qi}` as QueryId,
    text,
    intent,
    sourceUrl: `https://news.ycombinator.com/item?id=${40000000 + qi}`,
    knownAnswer: known,
    rankings,
  };
});

const arms: ArmResult[] = ARMS.map((arm) => ({
  arm,
  overall: quality(ARM_NDCG[arm], 200),
  byIntent: Object.fromEntries(INTENTS.map((i) => [i, quality(+(ARM_NDCG[arm] + INTENT_SHIFT[i]).toFixed(2), 50)])),
  speed: {
    p50Ms: ARM_P50[arm],
    p99Ms: ARM_P50[arm] * 2,
    costPer1kUsd: ARM_COST[arm],
    latencyBasis: arm === "haiku" ? "api" : "wall",
  },
  knownItemRanks: [1, 2, 5, 10, null, 3, 1, 20, 50, null].map((r) => (r === null ? null : Math.max(1, r - (arm === "none" ? 0 : 1)))),
}));

const confusion = (diag: number) => INTENTS.map((_, a) => INTENTS.map((_, p) => (a === p ? diag : (50 - diag) / 3)));
const routers: RouterResult[] = [
  { router: "haiku", accuracy: 0.9, n: 200, confusion: confusion(45), speed: { p50Ms: 1000, p99Ms: 2000, costPer1kUsd: 0.5, latencyBasis: "api" } },
  { router: "jev", accuracy: 0.8, n: 200, confusion: confusion(40), speed: { p50Ms: 100, p99Ms: 200, costPer1kUsd: 0.01, latencyBasis: "wall" } },
];

const results: Results = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  jevPilot: {
    queries: 20,
    chosen: "per_pair",
    rows: [
      { formulation: "per_pair", description: "one call per candidate, query + card in state", ndcg10: 0.6, p50Ms: 500, costPer1kUsd: 0.5, requestsPerSearch: 100 },
      { formulation: "fan_out", description: "one call per query, 100 questions each carrying a card", ndcg10: 0.5, p50Ms: 300, costPer1kUsd: 0.5, requestsPerSearch: 1 },
    ],
  },
  snapshot: SNAPSHOT,
  synthetic: true,
  queryCounts: { competitor: 50, product: 50, job: 50, open_source: 50 },
  gradedPairs: 8000,
  judgeAgreement: { n: 200, exact: 0.7, within1: 0.9, kappa: 0.6 },
  arms,
  routers,
  calibration: Array.from({ length: 10 }, (_, i) => ({
    lo: i / 10,
    hi: (i + 1) / 10,
    n: 20,
    meanConfidence: (i + 0.5) / 10,
    accuracy: Math.min(1, (i + 1) / 10),
  })),
  hypotheses: [
    { id: "H1", statement: "Jev Score reaches at least 90% of Claude Haiku's nDCG@10 as a reranker.", verdict: "rejected", evidence: "Jev 0.60 vs Haiku 0.70 (86%)." },
    { id: "H2", statement: "Jev Score's p50 latency for 100 candidates is under 10% of Haiku's.", verdict: "supported", evidence: "500 ms vs 8,000 ms (6%)." },
    { id: "H3", statement: "Jev Choice matches Haiku within 3 points of accuracy on intent routing.", verdict: "rejected", evidence: "80% vs 90%." },
    { id: "H4", statement: "Jev beats the open-source cross-encoder on accuracy.", verdict: "pending", evidence: "Fixture: no data." },
  ],
  explorer: { queries, companies: explorerCompanies },
};

writeFileSync("src/generated/results.fixture.json", JSON.stringify(results, null, 2) + "\n");
console.log("wrote src/generated/results.fixture.json");
