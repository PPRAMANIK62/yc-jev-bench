"use client";

import Link from "next/link";
import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { INTENTS, INTENT_LABEL, type Intent } from "@/lib/domain";
import { ms, usd } from "@/lib/format";
import { ResultRow } from "./result-row";
import { reduce, rowsOf, streamSearch, type Search } from "./search-state";

const EXAMPLES = [
  "who else does AI bookkeeping for small agencies",
  "a tool to catch flaky tests in CI",
  "infra startups hiring Go engineers, remote-friendly",
  "open-source databases I could contribute to",
];

const UNSURE = 0.6;

function isIntent(v: string | null): v is Intent {
  return v !== null && (INTENTS as readonly string[]).includes(v);
}

export function SearchApp({ initial }: { initial: { q: string | null; intent: string | null } }) {
  const [text, setText] = useState(initial.q ?? "");
  const [state, dispatch] = useReducer(reduce, { status: "idle" });
  const inflight = useRef<AbortController | null>(null);

  const run = useCallback((raw: string, intent: Intent | null) => {
    const query = raw.trim();
    if (!query) return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setText(query);
    const url = new URLSearchParams({ q: query });
    if (intent) url.set("intent", intent);
    window.history.replaceState(null, "", `/?${url}`);
    dispatch({ type: "start", query, intent });
    streamSearch({ query, intent: intent ?? undefined }, ctrl.signal, (event) => {
      if (!ctrl.signal.aborted) dispatch({ type: "event", event });
    }).catch((err: unknown) => {
      if (ctrl.signal.aborted) return;
      dispatch({ type: "failed", message: err instanceof Error ? err.message : "The search didn't complete." });
    });
  }, []);

  useEffect(() => {
    if (initial.q) run(initial.q, isIntent(initial.intent) ? initial.intent : null);
    return () => inflight.current?.abort();
    // Only the URL at first load starts a search; later searches write the URL themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = state.status === "idle" ? null : state.search;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 sm:px-8">
      <section className="pt-14 sm:pt-24">
        <h1 className="narrow max-w-[16ch] text-[40px] leading-[1.02] font-semibold text-ink sm:text-[64px]">
          Search every YC company in plain English
        </h1>
        <form
          role="search"
          className="mt-8 sm:mt-10"
          onSubmit={(e) => {
            e.preventDefault();
            run(text, null);
          }}
        >
          <label htmlFor="q" className="sr-only">
            Describe the company you&rsquo;re looking for
          </label>
          <div className="flex items-center gap-2 rounded-[10px] border border-rule bg-surface pr-2 transition-colors duration-[120ms] focus-within:border-arm-jev">
            <input
              id="q"
              name="q"
              type="search"
              value={text}
              maxLength={300}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              placeholder="who else does AI bookkeeping for small agencies"
              className="h-14 min-w-0 flex-1 bg-transparent pl-4 text-[17px] text-ink outline-none placeholder:text-muted-ink/70 sm:h-16 sm:pl-5 sm:text-[19px] [&::-webkit-search-cancel-button]:hidden"
              style={{ outline: "none" }}
            />
            <button
              type="submit"
              className="label flex h-10 shrink-0 items-center gap-2 rounded-[8px] bg-arm-jev px-3.5 text-[12px] text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-40"
              disabled={!text.trim()}
            >
              Search <span aria-hidden>⏎</span>
            </button>
          </div>
        </form>
        {search ? <IntentChips search={search} done={state.status === "done"} onPick={(i) => run(search.query, i)} /> : null}
      </section>

      {search ? <Results search={search} done={state.status === "done"} /> : <Examples onPick={(q) => run(q, null)} />}
    </main>
  );
}

function Examples({ onPick }: { onPick: (q: string) => void }) {
  return (
    <section className="mt-12" aria-labelledby="examples">
      <h2 id="examples" className="label text-muted-ink">
        Try one of these
      </h2>
      <ul className="mt-3 flex flex-col">
        {EXAMPLES.map((q) => (
          <li key={q} className="border-b border-rule">
            <button
              type="button"
              onClick={() => onPick(q)}
              className="group flex w-full items-baseline justify-between gap-4 py-3.5 text-left text-[17px] text-ink transition-colors duration-[120ms] hover:text-arm-jev"
            >
              <span>{q}</span>
              <span aria-hidden className="label text-muted-ink transition-colors duration-[120ms] group-hover:text-arm-jev">
                Search →
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IntentChips({ search, done, onPick }: { search: Search; done: boolean; onPick: (i: Intent) => void }) {
  const route = search.route;
  const unsure = route !== null && !route.overridden && route.confidence < UNSURE;
  const routeFailed = Boolean(search.errors.route);
  if (!unsure && !done) return null;
  if (!route && !routeFailed) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="label text-muted-ink">
        {unsure ? "Jev isn’t sure what you’re after. Pick one:" : route?.overridden ? "You picked" : "Search for"}
      </p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Intent">
        {INTENTS.map((i) => {
          const on = route?.intent === i;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(i)}
              className={`rounded-full border px-3 py-1 text-[14px] transition-colors duration-[120ms] active:scale-[0.97] ${
                on ? "border-arm-jev bg-arm-jev text-white" : "border-rule text-ink hover:border-ink"
              }`}
            >
              {INTENT_LABEL[i]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Results({ search, done }: { search: Search; done: boolean }) {
  const rows = rowsOf(search);
  const failed = search.errors.retrieve;
  return (
    <section className="mt-10" aria-live="polite" aria-busy={!done}>
      {failed ? <p className="border-y border-rule py-4 text-[15px] text-ink">{failed}</p> : null}
      {search.errors.rerank && search.retrieved ? (
        <p className="label mb-3 text-muted-ink">{search.errors.rerank}</p>
      ) : null}
      {!failed && rows.length === 0 && done ? (
        <p className="border-y border-rule py-4 text-[15px] text-ink">
          No companies matched. Try describing what the company does rather than its name.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <ol className="relative border-t border-rule">
          <AnimatePresence mode="popLayout">
            {rows.map((row, i) => (
              <ResultRow key={row.company.id} row={row} index={i} />
            ))}
          </AnimatePresence>
        </ol>
      ) : !failed && !done ? (
        <SkeletonRows />
      ) : null}
      <UnderTheHood search={search} done={done} />
    </section>
  );
}

function SkeletonRows() {
  return (
    <ol className="border-t border-rule" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-5 sm:grid-cols-[2.75rem_8rem_minmax(0,1fr)] sm:gap-x-4">
          <span className="h-3 w-4 rounded bg-rule/60" />
          <span className="hidden sm:block" />
          <span className="flex flex-col gap-2">
            <span className="h-3.5 w-40 rounded bg-rule/60" />
            <span className="h-3 w-3/4 rounded bg-rule/40" />
          </span>
        </li>
      ))}
    </ol>
  );
}

function UnderTheHood({ search, done }: { search: Search; done: boolean }) {
  const { route, hits, rerankMs, costUsd, candidates, errors } = search;
  const parts: string[] = [];
  if (route) {
    parts.push(route.overridden ? `You picked: ${route.intent}` : `Jev: ${route.intent} (${route.confidence.toFixed(2)})`);
  } else if (errors.route) {
    parts.push("Not routed");
  }
  if (hits && rerankMs !== null) parts.push(`reranked ${candidates} companies in ${ms(rerankMs)}`);
  else if (done && search.retrieved) parts.push(`${candidates} candidates, retrieval order`);
  if (hits && costUsd !== null) parts.push(usd(costUsd));

  const pending = !done
    ? !route && !errors.route
      ? "Routing your query…"
      : !search.retrieved
        ? "Retrieving candidates…"
        : `Reranking ${candidates} candidates with Jev…`
    : null;

  return (
    <p className="label mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-muted-ink">
      {parts.map((p, i) => (
        <span key={i} className="whitespace-nowrap">
          {i > 0 ? <span className="mr-2 text-rule">·</span> : null}
          {p}
        </span>
      ))}
      {pending ? (
        <span className="whitespace-nowrap">
          {parts.length > 0 ? <span className="mr-2 text-rule">·</span> : null}
          {pending}
        </span>
      ) : null}
      <span className="whitespace-nowrap">
        <span className="mr-2 text-rule">·</span>
        <Link href="/report" className="text-ink underline decoration-rule underline-offset-2 transition-colors duration-[120ms] hover:decoration-ink">
          how this was tested →
        </Link>
      </span>
    </p>
  );
}
