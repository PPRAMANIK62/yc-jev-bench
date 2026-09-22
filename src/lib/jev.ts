import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { TypeSafeClient, choice, noul } from "@typesafe-ai/sdk";
import { companyCard } from "./cards";
import { INTENTS, JEV_FORMULATIONS, type CallCost, type Company, type Intent, type JevFormulation, type RouteDecision } from "./domain";
import { mapLimit } from "./pool";

export const JEV_MODEL = "jev-1.13.0";
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1e6;
// 1,200 req/min is 20/s; 16 in flight stays under it at Jev's observed sub-second latency.
const PER_PAIR_CONCURRENCY = 16;
const REQUEST_TOKEN_LIMIT = 64_000;
export const JEV_PILOT_FILE = "data/jev-pilot.json";

// Until bench/pilot.ts has run, fall back to per_pair: it is the TypeSafe rerank cookbook's method
// and avoids the large-state accuracy drop the Jev 1.13 notes warn about.
export const JEV_CHOSEN: JevFormulation = (() => {
  const path = join(process.cwd(), JEV_PILOT_FILE);
  if (!existsSync(path)) return "per_pair";
  const chosen = (JSON.parse(readFileSync(path, "utf8")) as { chosen: string }).chosen;
  if (!JEV_FORMULATIONS.includes(chosen as JevFormulation)) throw new Error(`${JEV_PILOT_FILE}: unknown formulation ${chosen}`);
  return chosen as JevFormulation;
})();

let client: TypeSafeClient | null = null;
function jev(): TypeSafeClient {
  if (!process.env.TYPESAFE_API_KEY) {
    throw new Error("TYPESAFE_API_KEY is not set. Add it to .env.local (Bun and Next both load it) before running any Jev path.");
  }
  client ??= new TypeSafeClient({ defaultModel: JEV_MODEL });
  return client;
}

const cost = (wallMs: number, inputTokens: number, outputTokens: number): CallCost => ({
  wallMs,
  apiMs: null, // Jev reports no server timing; latency is wall time from this process
  inputTokens,
  outputTokens,
  costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN,
});

// Shared with the Haiku router so both routers see the same option descriptions.
export const INTENT_OPTIONS: Record<Intent, { what: string; examples: string[] }> = {
  competitor: {
    what: "The searcher describes a problem or a business and wants to find companies that do the same thing, such as competitors or companies solving the same problem.",
    examples: ["who else does AI bookkeeping for small agencies", "companies building software for dental clinics to handle insurance claims"],
  },
  product: {
    what: "The searcher wants a tool, app, or service they can use or buy for a need they have.",
    examples: ["is there a tool to catch flaky tests in CI", "alternative to Zapier for internal workflows"],
  },
  job: {
    what: "The searcher wants to work at a company: they are looking for startups that are hiring people with their skills or in their location.",
    examples: ["startups hiring engineers who know Go, Kubernetes, remote-friendly", "hiring Python engineers in Berlin"],
  },
  open_source: {
    what: "The searcher wants open-source software: a project to use, self-host, or contribute code to.",
    examples: ["open-source YC projects I could contribute to in Rust", "self-hosted open source alternative to Datadog"],
  },
};

export async function jevRoute(query: string): Promise<{ decision: Omit<RouteDecision, "overridden">; cost: CallCost; model: string }> {
  const client = jev();
  const t0 = performance.now();
  const res = await client.systemOne({
    state: { search_query: query },
    questions: {
      intent: choice("What is the person who typed search_query looking for in a directory of YC startups?", INTENT_OPTIONS),
    },
  });
  const wallMs = performance.now() - t0;
  const a = res.answers.intent;
  const probabilities = Object.fromEntries(INTENTS.map((i) => [i, a.probabilities[i] ?? 0])) as Record<Intent, number>;
  return {
    decision: { intent: a.choice, confidence: a.confidence, probabilities },
    cost: cost(wallMs, res.usage.input_tokens, res.usage.output_tokens),
    model: res.model,
  };
}

const MATCH_INSTRUCTIONS =
  "The searcher typed query into a search box over a directory of YC startups. Is this company what the searcher is looking for? Answer yes only if the company itself matches what the query asks for.";
const MATCH_CRITERIA = {
  true: "This company is what the searcher is looking for: it does what the query describes, or it matches the kind of company the query asks for.",
  false: "This company is only loosely related, shares a keyword or industry with the query, or does something different from what the query asks for.",
};

const roughTokens = (x: unknown) => Math.ceil(JSON.stringify(x).length / 4);

export async function jevRerank(
  query: string,
  companies: Company[],
  formulation: JevFormulation = JEV_CHOSEN,
): Promise<{ scores: number[]; confidences: number[] | null; cost: CallCost; model: string }> {
  const client = jev();
  const t0 = performance.now();

  if (formulation === "per_pair") {
    const results = await mapLimit(companies, PER_PAIR_CONCURRENCY, (c) =>
      client.systemOne({
        state: { query, company: companyCard(c) },
        questions: { match: noul(MATCH_INSTRUCTIONS, MATCH_CRITERIA) },
      }),
    );
    const input = results.reduce((s, r) => s + r.usage.input_tokens, 0);
    const output = results.reduce((s, r) => s + r.usage.output_tokens, 0);
    return {
      scores: results.map((r) => r.answers.match.noul),
      confidences: null, // Noul has no confidence; the noul is itself the yes-probability
      cost: cost(performance.now() - t0, input, output),
      model: results[0]?.model ?? JEV_MODEL,
    };
  }

  const questions = Object.fromEntries(
    companies.map((c, i) => [`c${i}`, noul({ company: companyCard(c), question: MATCH_INSTRUCTIONS.replace("this company", "the company") }, MATCH_CRITERIA)]),
  );
  const request = { state: { query }, questions };
  const estimate = roughTokens(request);
  if (estimate > REQUEST_TOKEN_LIMIT * 0.9) throw new Error(`fan_out request is ~${estimate} tokens, too close to Jev's ${REQUEST_TOKEN_LIMIT} limit`);
  const res = await client.systemOne(request);
  return {
    scores: companies.map((_, i) => res.answers[`c${i}`].noul),
    confidences: null,
    cost: cost(performance.now() - t0, res.usage.input_tokens, res.usage.output_tokens),
    model: res.model,
  };
}
