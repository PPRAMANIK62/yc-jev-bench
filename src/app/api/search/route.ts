import { companyById } from "@/lib/companies";
import { INTENTS, type Company, type Intent, type SearchEvent, type SearchHit } from "@/lib/domain";
import { JEV_CHOSEN, jevRerank, jevRoute } from "@/lib/jev";
import { retrieve } from "@/lib/retrieve";

export const runtime = "nodejs";

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
          const { scores, cost } = await jevRerank(query, candidates, JEV_CHOSEN);
          emit({ type: "reranked", hits: rankByScore(candidates, scores), ms: performance.now() - k0, costUsd: cost.costUsd });
        } catch (err) {
          console.error("jevRerank failed", err);
          emit({ type: "error", stage: "rerank", message: "Jev didn't answer in time. Showing results without reranking." });
        }
      }
      finish();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
