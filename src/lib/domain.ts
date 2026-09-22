// Shared vocabulary for the benchmark (bench/) and the app (src/app/).
// Everything that crosses a file on disk is typed here once.

export const INTENTS = ["competitor", "product", "job", "open_source"] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABEL: Record<Intent, string> = {
  competitor: "Competitors",
  product: "Products",
  job: "Jobs",
  open_source: "Open source",
};

export type CompanyId = number & { readonly __brand: "CompanyId" };
export type QueryId = string & { readonly __brand: "QueryId" };

export type CompanyStatus = "Active" | "Inactive" | "Acquired" | "Public";

// The normalized company. Parsed once from the yc-oss snapshot in src/lib/companies.ts.
export interface Company {
  id: CompanyId;
  name: string;
  slug: string;
  oneLiner: string;
  description: string;
  industry: string;
  subindustry: string;
  tags: string[];
  batch: string; // "Winter 2012"
  batchShort: string; // "W12"
  status: CompanyStatus;
  teamSize: number | null;
  location: string;
  regions: string[];
  isHiring: boolean;
  isOpenSource: boolean;
  website: string;
  ycUrl: string;
  logoUrl: string;
}

// Every arm is a registry entry. Adding an arm means adding a row here and a Reranker implementation.
export const ARMS = ["none", "bge", "haiku", "jev"] as const;
export type ArmId = (typeof ARMS)[number];

export const ROUTERS = ["haiku", "jev"] as const;
export type RouterId = (typeof ROUTERS)[number];

export interface ArmSpec {
  label: string;
  model: string;
  runsWhere: "local" | "api" | "claude-code";
}

export const ARM_SPEC: Record<ArmId, ArmSpec> = {
  none: { label: "No reranking", model: "hybrid retrieval order", runsWhere: "local" },
  bge: { label: "BGE cross-encoder", model: "bge-reranker-v2-m3 (ONNX)", runsWhere: "local" },
  haiku: { label: "Claude Haiku 4.5", model: "claude-haiku-4-5-20251001", runsWhere: "claude-code" },
  jev: { label: "Jev", model: "jev (TypeSafe)", runsWhere: "api" },
};

export type QuerySource =
  | { kind: "launch_hn"; hnId: string; url: string }
  | { kind: "ask_hn"; hnId: string; url: string }
  | { kind: "wwtbh"; hnId: string; url: string; thread: string };

export interface BenchQuery {
  id: QueryId;
  // dev queries pick each API arm's formulation; test queries produce every reported number
  split: "dev" | "test";
  intent: Intent;
  text: string;
  source: QuerySource;
  // Launch HN only: the company that wrote the post. Enables the judge-free check.
  knownAnswer: CompanyId | null;
}

// What every paid call reports. Null fields mean "this arm has no such cost" (local models).
export interface CallCost {
  wallMs: number;
  apiMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

// runs/candidates.jsonl: retrieval is frozen once so every arm reranks the identical 100.
export interface CandidateSet {
  queryId: QueryId;
  candidateIds: CompanyId[]; // hybrid retrieval order, length <= 100
}

// runs/rerank-<arm>[-<formulation>].jsonl: one line per query.
export interface RerankRun extends CallCost {
  queryId: QueryId;
  arm: ArmId;
  // Aligned with CandidateSet.candidateIds. Higher is more relevant.
  scores: number[];
  // Jev only: confidence per candidate as returned by the API.
  confidences: number[] | null;
  at: string;
}

// runs/route-<router>.jsonl
export interface RouteRun extends CallCost {
  queryId: QueryId;
  router: RouterId;
  predicted: Intent;
  probabilities: Record<Intent, number> | null;
  confidence: number | null;
  at: string;
}

export type Grade = 0 | 1 | 2;

// data/grades.<by>.jsonl
export interface GradeRecord {
  queryId: QueryId;
  companyId: CompanyId;
  grade: Grade;
  by: "opus" | "human";
  at: string;
}

// ---------------------------------------------------------------------------
// src/generated/results.json: the only thing the report reads.
// Produced by bench/score.ts. Arms or routers that have not been run are absent, not zeroed.

export interface Interval {
  mean: number;
  lo: number; // 95% bootstrap over queries
  hi: number;
}

export interface QualityMetrics {
  ndcg10: Interval;
  recall10: Interval;
  mrr: Interval;
  n: number; // queries with at least one grade-2 or grade-1 company
}

export interface SpeedCost {
  p50Ms: number;
  p99Ms: number;
  costPer1kUsd: number | null;
  latencyBasis: "api" | "wall";
}

export interface ArmResult {
  arm: ArmId;
  overall: QualityMetrics;
  byIntent: Partial<Record<Intent, QualityMetrics>>;
  speed: SpeedCost;
  // Launch HN queries: 1-based rank of the known company after reranking, null if outside the 100.
  knownItemRanks: (number | null)[];
}

export interface RouterResult {
  router: RouterId;
  accuracy: number;
  n: number;
  // confusion[actual][predicted], ordered by INTENTS
  confusion: number[][];
  speed: SpeedCost;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  meanConfidence: number;
  accuracy: number;
}

export type Verdict = "supported" | "rejected" | "pending";

export interface HypothesisResult {
  id: "H1" | "H2" | "H3" | "H4";
  statement: string;
  verdict: Verdict;
  evidence: string;
}

export interface ExplorerCompany {
  id: CompanyId;
  name: string;
  oneLiner: string;
  batchShort: string;
}

export interface ExplorerQuery {
  id: QueryId;
  text: string;
  intent: Intent;
  sourceUrl: string;
  knownAnswer: CompanyId | null;
  // top 10 per arm that has run
  rankings: Partial<Record<ArmId, { id: CompanyId; grade: Grade | null }[]>>;
}

// Jev and Haiku can each be asked more than one way; a pilot per arm on held-out dev queries picks one
// before the test set is touched.
export const JEV_FORMULATIONS = ["per_pair", "fan_out"] as const;
export const HAIKU_FORMULATIONS = ["batch_100", "batch_10"] as const;
export const FORMULATIONS = { jev: JEV_FORMULATIONS, haiku: HAIKU_FORMULATIONS } as const;
export type PilotArm = keyof typeof FORMULATIONS;
export type Formulation<A extends PilotArm = PilotArm> = (typeof FORMULATIONS)[A][number];
export type JevFormulation = Formulation<"jev">;
export type HaikuFormulation = Formulation<"haiku">;

export const isPilotArm = (arm: ArmId): arm is PilotArm => arm in FORMULATIONS;

export interface PilotRow<A extends PilotArm = PilotArm> {
  formulation: Formulation<A>;
  description: string;
  ndcg10: number;
  p50Ms: number;
  costPer1kUsd: number;
  requestsPerSearch: number;
}

// data/pilot-<arm>.json
export interface Pilot<A extends PilotArm = PilotArm> {
  queries: number;
  chosen: Formulation<A>;
  rows: PilotRow<A>[];
}

export type Pilots = { [A in PilotArm]?: Pilot<A> };

// How well one run's scores agree with the judge, by where the candidate sat in the retrieval list.
// Index i covers retrieval positions [i * POSITION_BAND, (i + 1) * POSITION_BAND).
export const POSITION_BAND = 25;
export interface PositionDecay {
  arm: PilotArm;
  formulation: Formulation;
  queries: number;
  r: number[]; // Pearson r of score vs Opus grade over judged pairs in the band, pooled across queries
  relevant: number[]; // share of those pairs graded 1 or 2
  pairs: number[];
}

export interface Results {
  generatedAt: string;
  pilots: Pilots;
  positionDecay: PositionDecay[]; // test split, every pilot formulation that has test runs
  snapshot: string; // data file the run used
  // true only for the UI development fixture; the report shows a banner when set
  synthetic: boolean;
  queryCounts: Record<Intent, number>;
  gradedPairs: number;
  judgeAgreement: { n: number; exact: number; within1: number; kappa: number } | null;
  arms: ArmResult[];
  routers: RouterResult[];
  calibration: CalibrationBin[] | null; // Jev router confidence vs correctness
  hypotheses: HypothesisResult[];
  explorer: { queries: ExplorerQuery[]; companies: Record<number, ExplorerCompany> };
}

// ---------------------------------------------------------------------------
// Live search contract: POST /api/search, answered as NDJSON, one SearchEvent per line.
// The UI shows retrieval order first, then animates rows into Jev's order.

export interface SearchRequest {
  query: string;
  // set when the user overrides the router by clicking an intent chip
  intent?: Intent;
}

export interface RouteDecision {
  intent: Intent;
  confidence: number;
  probabilities: Record<Intent, number>;
  overridden: boolean;
}

export interface SearchHit {
  company: Company;
  retrievalRank: number; // 1-based position in the 100 candidates, before Jev
  rank: number; // 1-based, after Jev
  score: number;
}

export type SearchEvent =
  | { type: "routed"; route: RouteDecision; ms: number }
  | { type: "retrieved"; top: { company: Company; retrievalRank: number }[]; candidates: number; ms: number }
  | { type: "reranked"; hits: SearchHit[]; ms: number; costUsd: number | null }
  | { type: "done"; totalMs: number }
  | { type: "error"; stage: "route" | "retrieve" | "rerank"; message: string };
