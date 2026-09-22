import type { Company, Intent, RetrievalMode, RouteDecision, SearchEvent, SearchHit } from "@/lib/domain";

export type Stage = Extract<SearchEvent, { type: "error" }>["stage"];

export interface Search {
  query: string;
  intent: Intent | null;
  route: RouteDecision | null;
  routeMs: number | null;
  retrieved: { company: Company; retrievalRank: number }[] | null;
  candidates: number;
  retrieveMs: number | null;
  retrievalMode: RetrievalMode | null;
  hits: SearchHit[] | null;
  rerankMs: number | null;
  costUsd: number | null;
  totalMs: number | null;
  errors: Partial<Record<Stage, string>>;
}

export type SearchState = { status: "idle" } | { status: "running" | "done"; search: Search };

export type SearchAction =
  | { type: "start"; query: string; intent: Intent | null }
  | { type: "event"; event: SearchEvent }
  | { type: "failed"; message: string };

export const TOP = 10;

export function reduce(state: SearchState, action: SearchAction): SearchState {
  if (action.type === "start") {
    return {
      status: "running",
      search: {
        query: action.query,
        intent: action.intent,
        route: null,
        routeMs: null,
        retrieved: null,
        candidates: 0,
        retrieveMs: null,
        retrievalMode: null,
        hits: null,
        rerankMs: null,
        costUsd: null,
        totalMs: null,
        errors: {},
      },
    };
  }
  if (state.status === "idle") return state;
  const s = state.search;
  if (action.type === "failed") {
    return { status: "done", search: { ...s, errors: { ...s.errors, retrieve: action.message } } };
  }
  const e = action.event;
  switch (e.type) {
    case "routed":
      return { ...state, search: { ...s, route: e.route, routeMs: e.ms } };
    case "retrieved":
      return { ...state, search: { ...s, retrieved: e.top, candidates: e.candidates, retrieveMs: e.ms, retrievalMode: e.mode } };
    case "reranked":
      return { ...state, search: { ...s, hits: e.hits, rerankMs: e.ms, costUsd: e.costUsd } };
    case "error":
      return { ...state, search: { ...s, errors: { ...s.errors, [e.stage]: e.message } } };
    case "done":
      return { status: "done", search: { ...s, totalMs: e.totalMs } };
  }
}

export interface Row {
  company: Company;
  rank: number;
  retrievalRank: number;
  reranked: boolean;
}

export function rowsOf(s: Search): Row[] {
  if (s.hits) {
    return s.hits.slice(0, TOP).map((h) => ({ company: h.company, rank: h.rank, retrievalRank: h.retrievalRank, reranked: true }));
  }
  return (s.retrieved ?? []).slice(0, TOP).map((r) => ({
    company: r.company,
    rank: r.retrievalRank,
    retrievalRank: r.retrievalRank,
    reranked: false,
  }));
}

export async function streamSearch(
  body: { query: string; intent?: Intent },
  signal: AbortSignal,
  onEvent: (e: SearchEvent) => void,
): Promise<void> {
  const res = await fetch("/api/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `The search server answered ${res.status}.`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as SearchEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as SearchEvent);
}
