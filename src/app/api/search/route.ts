import { INTENTS, type Company, type Intent, type SearchEvent, type SearchHit } from "@/lib/domain";

export const runtime = "nodejs";
// A cold search measures 3.0 s on the production build here: 1.3 s routing, 0.35 s to open the ONNX
// session and build the BM25 index over 6,245 cards, 1.3 s reranking. Warm it is 1.1 s. Thirty
// seconds leaves room for a slower container and a slow Jev fan-out without hanging a searcher.
export const maxDuration = 30;

const MAX_QUERY = 300;
const CANDIDATES = 100;
const TOP = 10;

type Parsed = { ok: true; query: string; intent: Intent | null } | { ok: false; message: string };

function parse(body: unknown): Parsed {
  if (typeof body !== "object" || body === null) return { ok: false, message: "Send a JSON body with a query." };
  const { query, intent } = body as Record<string, unknown>;
  if (typeof query !== "string" || !query.trim()) return { ok: false, message: "The query is empty." };
  if (query.length > MAX_QUERY) return { ok: false, message: `Keep the query under ${MAX_QUERY} characters.` };
  if (intent !== undefined && !INTENTS.includes(intent as Intent)) {
    return { ok: false, message: `intent must be one of ${INTENTS.join(", ")}.` };
  }
  return { ok: true, query: query.trim(), intent: (intent as Intent | undefined) ?? null };
}

function rankByScore(companies: Company[], scores: number[]): SearchHit[] {
  return companies
    .map((company, i) => ({ company, retrievalRank: i + 1, score: scores[i] }))
    .sort((a, b) => b.score - a.score || a.retrievalRank - b.retrievalRank)
    .slice(0, TOP)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

// TEMPORARY. Reports what the deployed function can actually see, to diagnose a 500 that only
// happens on Vercel. Delete once the deploy is proven. Reports no secret: the Jev key appears as a
// boolean and never as a value.
export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("diag") !== "1") return new Response("Use POST to search.", { status: 405 });
  const { createRequire } = await import("node:module");
  const { existsSync, statSync, readdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const require = createRequire(import.meta.url);

  const attempt = async (fn: () => unknown | Promise<unknown>) => {
    try {
      return { ok: true, value: String((await fn()) ?? "ok").slice(0, 120) };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { ok: false, code: e.code ?? null, message: (e.message ?? String(err)).split("\n")[0].slice(0, 300) };
    }
  };

  const cwd = process.cwd();
  const sizeOf = (p: string) => (existsSync(join(cwd, p)) ? statSync(join(cwd, p)).size : "MISSING");
  const listing = (p: string) => (existsSync(join(cwd, p)) ? readdirSync(join(cwd, p)) : "MISSING");

  return Response.json(
    {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cwd,
      cwdEntries: readdirSync(cwd).slice(0, 40),
      files: {
        "data/companies-2026-09-22.json": sizeOf("data/companies-2026-09-22.json"),
        "data/index/embeddings.f32": sizeOf("data/index/embeddings.f32"),
        "data/index/ids.json": sizeOf("data/index/ids.json"),
        "models/Xenova/bge-small-en-v1.5/config.json": sizeOf("models/Xenova/bge-small-en-v1.5/config.json"),
        "models/Xenova/bge-small-en-v1.5/tokenizer.json": sizeOf("models/Xenova/bge-small-en-v1.5/tokenizer.json"),
        "models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx": sizeOf("models/Xenova/bge-small-en-v1.5/onnx/model_quantized.onnx"),
      },
      onnxruntimeNode: listing("node_modules/onnxruntime-node"),
      onnxruntimeNodeBin: listing("node_modules/onnxruntime-node/bin/napi-v6"),
      requireOnnxruntimeNode: await attempt(() => Object.keys(require("onnxruntime-node")).length + " exports"),
      importTransformers: await attempt(async () => typeof (await import("@huggingface/transformers")).pipeline),
      embedQuery: await attempt(async () => (await (await import("@/lib/embed")).embedQuery("a tool to catch flaky tests in CI")).length + " dims"),
      retrieve: await attempt(async () => (await (await import("@/lib/retrieve")).retrieve("flaky tests", { intent: null, k: 10 })).mode),
      typesafeApiKeySet: Boolean(process.env.TYPESAFE_API_KEY),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const parsed = parse(await request.json().catch(() => null));
  if (!parsed.ok) return new Response(parsed.message, { status: 400 });
  const { query, intent: override } = parsed;
  const jevConfigured = Boolean(process.env.TYPESAFE_API_KEY);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (e: SearchEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      const t0 = performance.now();
      const finish = () => {
        emit({ type: "done", totalMs: performance.now() - t0 });
        controller.close();
      };

      // Every import below is dynamic and inside a catch. A dependency missing from the deployed
      // function used to take the whole module down at import time, which the platform answers with
      // an empty 500 the page cannot explain. Failing inside the stream turns that into a named
      // stage and a sentence the searcher can read.
      try {
        // Routing runs before retrieval, not beside it: the intent's hard filters live inside retrieve(),
        // and re-implementing them here to filter a wider unfiltered pool would fork that definition.
        let intent: Intent | null = override;
        if (override) {
          const probabilities = Object.fromEntries(INTENTS.map((i) => [i, i === override ? 1 : 0])) as Record<Intent, number>;
          emit({ type: "routed", route: { intent: override, confidence: 1, probabilities, overridden: true }, ms: 0 });
        } else if (!jevConfigured) {
          emit({ type: "error", stage: "route", message: "Jev isn't configured on this server, so results aren't filtered by intent." });
        } else {
          const r0 = performance.now();
          try {
            const { jevRoute } = await import("@/lib/jev");
            const { decision } = await jevRoute(query);
            intent = decision.intent;
            emit({ type: "routed", route: { ...decision, overridden: false }, ms: performance.now() - r0 });
          } catch (err) {
            console.error("jevRoute failed", err);
            emit({ type: "error", stage: "route", message: "Jev couldn't pick an intent, so results aren't filtered by intent." });
          }
        }

        let candidates: Company[];
        try {
          const [{ retrieve }, { companyById }] = await Promise.all([import("@/lib/retrieve"), import("@/lib/companies")]);
          const { ids, ms, mode } = await retrieve(query, { intent, k: CANDIDATES });
          candidates = ids.map(companyById);
          const top = candidates.slice(0, TOP).map((company, i) => ({ company, retrievalRank: i + 1 }));
          emit({ type: "retrieved", top, candidates: candidates.length, ms, mode });
        } catch (err) {
          console.error("retrieve failed", err);
          emit({ type: "error", stage: "retrieve", message: "Search failed on the server. Try again in a moment." });
          return finish();
        }

        if (!jevConfigured) {
          emit({ type: "error", stage: "rerank", message: "Jev isn't configured on this server. Showing results without reranking." });
        } else if (candidates.length > 0) {
          const k0 = performance.now();
          try {
            const { JEV_CHOSEN, jevRerank } = await import("@/lib/jev");
            const { scores, cost } = await jevRerank(query, candidates, JEV_CHOSEN);
            emit({ type: "reranked", hits: rankByScore(candidates, scores), ms: performance.now() - k0, costUsd: cost.costUsd });
          } catch (err) {
            console.error("jevRerank failed", err);
            emit({ type: "error", stage: "rerank", message: "Jev didn't answer in time. Showing results without reranking." });
          }
        }
        finish();
      } catch (err) {
        console.error("search failed", err);
        emit({ type: "error", stage: "retrieve", message: "Search failed on the server. Try again in a moment." });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
