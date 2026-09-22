import { AutoModelForSequenceClassification, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from "@huggingface/transformers";
import { companyCard } from "./cards";
import { HAIKU, claudeJson, extractJson } from "./claude";
import type { ArmId, CallCost, Company, Formulation, HaikuFormulation } from "./domain";
import { jevRerank } from "./jev";
import { formulationFor } from "./pilot";

export interface RerankInput {
  query: string;
  companies: Company[]; // retrieval order
  // API arms only; defaults to the arm's pilot pick
  formulation?: Formulation;
}

export interface RerankOutput {
  scores: number[]; // aligned with companies, higher is more relevant
  confidences: number[] | null;
  cost: CallCost;
  model: string;
}

const localCost = (wallMs: number): CallCost => ({ wallMs, apiMs: null, inputTokens: null, outputTokens: null, costUsd: null });


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


// Every reranker sees only the query and the cards: Jev and BGE get no intent, so Haiku gets none either.
export const HAIKU_RERANK_SYSTEM = `You are a search relevance grader for a directory of YC startups.
You get a search query and a numbered list of company cards.
Score how well each company matches what the searcher is looking for, from 0 (irrelevant) to 10 (exactly what they want).
Reply with only a JSON array of integers, one per company, in the order given. No prose.`;

export function haikuRerankPrompt(query: string, companies: Company[]): string {
  const cards = companies.map((c, i) => `[${i + 1}]\n${companyCard(c)}`).join("\n\n");
  return `Query: ${query}\n\nCompanies:\n\n${cards}\n\nReturn a JSON array of exactly ${companies.length} integers from 0 to 10.`;
}

const HAIKU_BATCH: Record<HaikuFormulation, number> = { batch_100: 100, batch_10: 10 };

// Every batch is sent at once, so a search takes as long as its slowest call and costs the sum of them.
async function haikuRerank({ query, companies, formulation }: RerankInput): Promise<RerankOutput> {
  const size = HAIKU_BATCH[formulationFor("haiku", formulation)];
  const batches = Array.from({ length: Math.ceil(companies.length / size) }, (_, i) => companies.slice(i * size, (i + 1) * size));
  const results = await Promise.all(
    batches.map((batch) =>
      claudeJson(HAIKU, HAIKU_RERANK_SYSTEM, haikuRerankPrompt(query, batch), (text) => {
        const arr = extractJson(text);
        if (!Array.isArray(arr) || arr.length !== batch.length || !arr.every((x) => Number.isInteger(x) && x >= 0 && x <= 10)) {
          throw new Error(`haiku returned ${Array.isArray(arr) ? arr.length : typeof arr} scores, expected ${batch.length} integers 0-10`);
        }
        return arr as number[];
      }),
    ),
  );
  const sum = (k: keyof CallCost) => results.reduce((s, r) => s + r.cost[k], 0);
  const max = (k: keyof CallCost) => Math.max(...results.map((r) => r.cost[k]));
  return {
    scores: results.flatMap((r) => r.value),
    confidences: null,
    cost: {
      wallMs: max("wallMs"),
      apiMs: max("apiMs"),
      inputTokens: sum("inputTokens"),
      outputTokens: sum("outputTokens"),
      costUsd: sum("costUsd"),
    },
    model: HAIKU,
  };
}


export const RERANKERS: Record<ArmId, (input: RerankInput) => Promise<RerankOutput>> = {
  none: async ({ companies }) => ({ scores: companies.map((_, i) => companies.length - i), confidences: null, cost: localCost(0), model: "retrieval order" }),
  bge: bgeRerank,
  haiku: haikuRerank,
  jev: async ({ query, companies, formulation }) => jevRerank(query, companies, formulationFor("jev", formulation)),
};

// Stable: ties keep retrieval order.
export function orderByScores<T>(items: T[], scores: number[]): T[] {
  return items.map((item, i) => ({ item, i, s: scores[i] })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.item);
}
