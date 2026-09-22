import { AutoModelForSequenceClassification, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from "@huggingface/transformers";
import { companyCard } from "./cards";
import { HAIKU, claudeJson, extractJson } from "./claude";
import type { ArmId, CallCost, Company, Intent, JevFormulation } from "./domain";
import { jevRerank } from "./jev";

export interface RerankInput {
  query: string;
  intent: Intent;
  companies: Company[]; // retrieval order
  formulation?: JevFormulation;
}

export interface RerankOutput {
  scores: number[]; // aligned with companies, higher is more relevant
  confidences: number[] | null;
  cost: CallCost;
  model: string;
}

const localCost = (wallMs: number): CallCost => ({ wallMs, apiMs: null, inputTokens: null, outputTokens: null, costUsd: null });

// ------------------------------------------------------------------ bge cross-encoder

const BGE_MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";
// Measured on 100 real cards (~183 tokens per pair): batch 8 took 15.4s, 25 took 19.9s, 100 took 23.6s.
const BGE_BATCH = 8;
let bge: Promise<{ tokenizer: PreTrainedTokenizer; model: PreTrainedModel }> | null = null;
function loadBge() {
  bge ??= Promise.all([
    AutoTokenizer.from_pretrained(BGE_MODEL),
    AutoModelForSequenceClassification.from_pretrained(BGE_MODEL, { dtype: "int8" }),
  ]).then(([tokenizer, model]) => ({ tokenizer, model }));
  return bge;
}

async function bgeRerank({ query, companies }: RerankInput): Promise<RerankOutput> {
  const { tokenizer, model } = await loadBge();
  const t0 = performance.now();
  const scores: number[] = [];
  for (let i = 0; i < companies.length; i += BGE_BATCH) {
    const cards = companies.slice(i, i + BGE_BATCH).map(companyCard);
    const inputs = tokenizer(new Array(cards.length).fill(query), { text_pair: cards, padding: true, truncation: true, max_length: 512 });
    const { logits } = (await model(inputs)) as { logits: Tensor };
    scores.push(...Array.from(logits.data as Float32Array));
  }
  return { scores, confidences: null, cost: localCost(performance.now() - t0), model: `${BGE_MODEL} int8` };
}

// ------------------------------------------------------------------ haiku, one call per query

const INTENT_MEANING: Record<Intent, string> = {
  competitor: "The searcher describes a product or problem and wants companies that do the same thing.",
  product: "The searcher wants a tool, app or service they could use for their need.",
  job: "The searcher is an engineer looking for a startup to work at: it should be hiring, and its work should fit their skills and location.",
  open_source: "The searcher wants open-source software to use, self-host or contribute to.",
};

export const HAIKU_RERANK_SYSTEM = `You are a search relevance grader for a directory of YC startups.
You get a search query and a numbered list of company cards.
Score how well each company matches what the searcher is looking for, from 0 (irrelevant) to 10 (exactly what they want).
Reply with only a JSON array of integers, one per company, in the order given. No prose.`;

export function haikuRerankPrompt(query: string, intent: Intent, companies: Company[]): string {
  const cards = companies.map((c, i) => `[${i + 1}]\n${companyCard(c)}`).join("\n\n");
  return `Query: ${query}\nWhat the searcher wants: ${INTENT_MEANING[intent]}\n\nCompanies:\n\n${cards}\n\nReturn a JSON array of exactly ${companies.length} integers from 0 to 10.`;
}

async function haikuRerank({ query, intent, companies }: RerankInput): Promise<RerankOutput> {
  const r = await claudeJson(HAIKU, HAIKU_RERANK_SYSTEM, haikuRerankPrompt(query, intent, companies), (text) => {
    const arr = extractJson(text);
    if (!Array.isArray(arr) || arr.length !== companies.length || !arr.every((x) => Number.isInteger(x) && x >= 0 && x <= 10)) {
      throw new Error(`haiku returned ${Array.isArray(arr) ? arr.length : typeof arr} scores, expected ${companies.length} integers 0-10`);
    }
    return arr as number[];
  });
  return { scores: r.value, confidences: null, cost: r.cost, model: HAIKU };
}

// ------------------------------------------------------------------ registry

export const RERANKERS: Record<ArmId, (input: RerankInput) => Promise<RerankOutput>> = {
  none: async ({ companies }) => ({ scores: companies.map((_, i) => companies.length - i), confidences: null, cost: localCost(0), model: "retrieval order" }),
  bge: bgeRerank,
  haiku: haikuRerank,
  jev: async ({ query, companies, formulation }) => jevRerank(query, companies, formulation),
};

// Stable: ties keep retrieval order.
export function orderByScores<T>(items: T[], scores: number[]): T[] {
  return items.map((item, i) => ({ item, i, s: scores[i] })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.item);
}
