"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ARM_SPEC,
  ARMS,
  INTENT_LABEL,
  INTENTS,
  type CompanyId,
  type ExplorerCompany,
  type ExplorerQuery,
  type Grade,
  type Intent,
} from "@/lib/domain";
import { ARM_COLOR, ARM_SHORT } from "./arms";

const COL_W = 196;
const GAP = 76;
const HEAD = 58;
const ROW_H = 34;
const TOP = 10;
const OUT_Y = HEAD + TOP * ROW_H + 30;
const WIDTH = ARMS.length * COL_W + (ARMS.length - 1) * GAP;
const HEIGHT = OUT_Y + 26;
const EASE = [0.23, 1, 0.32, 1] as const;
const COLLAPSED = 6;

type Slot = { rank: number; grade: Grade | null } | null;

interface Thread {
  id: CompanyId;
  grade: Grade | null;
  slots: Slot[]; // per column, null when outside that arm's top 10 or the arm hasn't run
}

const GRADE_STYLE: Record<"2" | "1" | "0" | "none", { width: number; opacity: number }> = {
  "2": { width: 2.5, opacity: 0.9 },
  "1": { width: 1.6, opacity: 0.5 },
  "0": { width: 1, opacity: 0.22 },
  none: { width: 1, opacity: 0.14 },
};

const GRADE_NAME: Record<"2" | "1" | "0" | "none", string> = {
  "2": "exact match",
  "1": "partial match",
  "0": "not relevant",
  none: "not graded",
};

function gradeKey(g: Grade | null): keyof typeof GRADE_STYLE {
  return g === null ? "none" : (String(g) as "2" | "1" | "0");
}

function threadsOf(q: ExplorerQuery): Thread[] {
  const byId = new Map<number, Thread>();
  ARMS.forEach((arm, col) => {
    q.rankings[arm]?.slice(0, TOP).forEach((entry, i) => {
      let t = byId.get(entry.id);
      if (!t) {
        t = { id: entry.id, grade: entry.grade, slots: ARMS.map(() => null) };
        byId.set(entry.id, t);
      }
      if (t.grade === null && entry.grade !== null) t.grade = entry.grade;
      t.slots[col] = { rank: i + 1, grade: entry.grade };
    });
  });
  return [...byId.values()];
}

const colX = (col: number) => col * (COL_W + GAP);
const rowY = (rank: number) => HEAD + (rank - 1) * ROW_H + ROW_H / 2;

function segment(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
}

export function Explorer({
  queries,
  companies,
}: {
  queries: ExplorerQuery[];
  companies: Record<number, ExplorerCompany>;
}) {
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string | null>(queries[0]?.id ?? null);

  const matches = useMemo(() => {
    const needle = text.trim().toLowerCase();
    return queries.filter((q) => (!intent || q.intent === intent) && (!needle || q.text.toLowerCase().includes(needle)));
  }, [queries, text, intent]);
  const shown = expanded ? matches : matches.slice(0, COLLAPSED);
  const query = queries.find((q) => q.id === selected) ?? null;

  if (queries.length === 0) {
    return <p className="label text-muted-ink">No queries have been run yet.</p>;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative block sm:w-[22rem]">
          <span className="sr-only">Filter queries by text</span>
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Filter ${queries.length} queries`}
            className="h-10 w-full rounded-[10px] border border-rule bg-surface px-3.5 text-[15px] text-ink outline-none transition-colors duration-[120ms] placeholder:text-muted-ink/80 focus:border-arm-jev"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by intent">
          {[null, ...INTENTS].map((i) => {
            const on = intent === i;
            return (
              <button
                key={i ?? "all"}
                type="button"
                aria-pressed={on}
                onClick={() => setIntent(i)}
                className={`rounded-full border px-3 py-1 text-[14px] transition-colors duration-[120ms] active:scale-[0.97] ${
                  on ? "border-ink bg-ink text-paper" : "border-rule text-ink hover:border-ink"
                }`}
              >
                {i ? INTENT_LABEL[i] : "All"}
              </button>
            );
          })}
        </div>
      </div>

      <ul className="mt-4 grid gap-x-8 md:grid-cols-2" aria-label="Queries">
        {shown.map((q) => {
          const on = q.id === selected;
          return (
            <li key={q.id} className="border-b border-rule">
              <button
                type="button"
                aria-current={on}
                onClick={() => setSelected(q.id)}
                className={`group flex w-full items-baseline gap-3 py-2.5 text-left transition-colors duration-[120ms] ${
                  on ? "text-ink" : "text-muted-ink hover:text-ink"
                }`}
              >
                <span className={`mt-[3px] h-2 w-2 shrink-0 self-start rounded-full ${on ? "bg-arm-jev" : "bg-transparent"}`} aria-hidden />
                <span className="line-clamp-1 flex-1 text-[15px]">{q.text}</span>
                <span className="label shrink-0">{INTENT_LABEL[q.intent]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="label mt-3 flex items-center gap-4 text-muted-ink">
        <span>
          {matches.length === queries.length ? `${queries.length} queries` : `${matches.length} of ${queries.length} queries match`}
        </span>
        {matches.length > COLLAPSED ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-ink underline decoration-rule underline-offset-2 transition-colors duration-[120ms] hover:decoration-ink"
          >
            {expanded ? "Show fewer" : `Show all ${matches.length} queries`}
          </button>
        ) : null}
        {matches.length === 0 ? <span>Nothing matches. Clear the filter to see every query.</span> : null}
      </div>

      {query ? <Bump key={query.id} query={query} companies={companies} /> : null}
    </div>
  );
}

function Bump({ query, companies }: { query: ExplorerQuery; companies: Record<number, ExplorerCompany> }) {
  const threads = useMemo(() => threadsOf(query), [query]);
  const [hover, setHover] = useState<CompanyId | null>(null);
  const [pinned, setPinned] = useState<CompanyId | null>(null);
  const active = hover ?? pinned;
  const frame = useRef<HTMLDivElement>(null);
  const inView = useInView(frame, { once: true, margin: "0px 0px -15% 0px" });
  const reduce = useReducedMotion();
  const drawn = inView || reduce;
  const ran = ARMS.map((arm) => Boolean(query.rankings[arm]));
  const [cursor, setCursor] = useState(() => `${Math.max(0, ran.indexOf(true))}:1`);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const col = Number(el.dataset.col);
    const rank = Number(el.dataset.rank);
    if (!el.dataset.col) return;
    const moves: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const m = moves[e.key];
    if (!m) {
      if (e.key === "Escape") setPinned(null);
      return;
    }
    e.preventDefault();
    let targetCol = col + m[0];
    let targetRank = rank + m[1];
    if (m[0] !== 0) {
      while (targetCol >= 0 && targetCol < ARMS.length && !ran[targetCol]) targetCol += m[0];
      const same = threads.find((t) => t.id === Number(el.dataset.id))?.slots[targetCol];
      if (same) targetRank = same.rank;
    }
    const next = frame.current?.querySelector<HTMLElement>(`[data-col="${targetCol}"][data-rank="${targetRank}"]`);
    next?.focus();
  };

  const source = query.sourceUrl ? new URL(query.sourceUrl).hostname.replace(/^www\./, "") : null;

  return (
    <figure className="mt-10">
      <figcaption className="mb-6 max-w-[68ch]">
        <p className="label text-muted-ink">
          {INTENT_LABEL[query.intent]}
          {source ? (
            <>
              {" · "}
              <a href={query.sourceUrl} className="underline decoration-rule underline-offset-2 hover:decoration-ink" target="_blank" rel="noreferrer">
                source on {source} ↗
              </a>
            </>
          ) : null}
        </p>
        <p className="mt-2 font-serif text-[22px] leading-snug text-ink sm:text-[24px]">&ldquo;{query.text}&rdquo;</p>
      </figcaption>

      <div className="relative -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div
          ref={frame}
          className="relative"
          style={{ width: WIDTH, height: HEIGHT }}
          onKeyDown={onKey}
          onMouseLeave={() => setHover(null)}
          role="group"
          aria-label="Top 10 per reranker. Arrow keys move between companies; Enter pins one."
        >
          <svg width={WIDTH} height={HEIGHT} className="absolute inset-0" aria-hidden>
            {ARMS.map((arm, col) => (
              <g key={arm}>
                <rect x={colX(col)} y={OUT_Y - 12} width={COL_W} height={24} rx={6} fill="var(--surface)" opacity={ran[col] ? 1 : 0.4} />
                <text x={colX(col) + 10} y={OUT_Y} dy="0.32em" className="fill-muted-ink font-mono text-[10.5px]">
                  not in top 10
                </text>
              </g>
            ))}
            {threads.map((t) => {
              const style = GRADE_STYLE[gradeKey(t.grade)];
              const isActive = active === t.id;
              const dim = active !== null && !isActive;
              return (
                <g
                  key={t.id}
                  style={{ opacity: dim ? 0.07 : 1, transition: "opacity 120ms ease" }}
                  onMouseEnter={() => setHover(t.id)}
                >
                  {ARMS.slice(0, -1).map((_, col) => {
                    if (!ran[col] || !ran[col + 1]) return null;
                    const a = t.slots[col];
                    const b = t.slots[col + 1];
                    if (!a && !b) return null;
                    const d = segment(colX(col) + COL_W, a ? rowY(a.rank) : OUT_Y, colX(col + 1), b ? rowY(b.rank) : OUT_Y);
                    return (
                      <motion.path
                        key={col}
                        d={d}
                        fill="none"
                        stroke="var(--ink)"
                        strokeLinecap="round"
                        strokeWidth={isActive ? 3 : style.width}
                        strokeOpacity={isActive ? 1 : style.opacity}
                        initial={reduce ? false : { pathLength: 0 }}
                        animate={drawn ? { pathLength: 1 } : { pathLength: 0 }}
                        transition={{ duration: 0.75, ease: EASE, delay: 0.15 + col * 0.22 }}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {ARMS.map((arm, col) => (
            <div key={arm} className="absolute top-0" style={{ left: colX(col), width: COL_W }}>
              <div className="h-[3px] rounded-full" style={{ background: ARM_COLOR[arm], opacity: ran[col] ? 1 : 0.3 }} />
              <p className={`mt-2 text-[15px] font-semibold ${ran[col] ? "text-ink" : "text-muted-ink"}`}>{ARM_SHORT[arm] === "None" ? "No reranking" : ARM_SHORT[arm]}</p>
              <p className="label truncate text-muted-ink">{ran[col] ? ARM_SPEC[arm].model : "not run yet"}</p>
            </div>
          ))}

          {threads.flatMap((t) =>
            t.slots.map((slot, col) => {
              if (!slot) return null;
              const c = companies[t.id];
              const isActive = active === t.id;
              const dim = active !== null && !isActive;
              const g = gradeKey(slot.grade ?? t.grade);
              const known = query.knownAnswer === t.id;
              return (
                <motion.button
                  key={`${t.id}-${col}`}
                  type="button"
                  data-col={col}
                  data-rank={slot.rank}
                  data-id={t.id}
                  onMouseEnter={() => setHover(t.id)}
                  tabIndex={cursor === `${col}:${slot.rank}` ? 0 : -1}
                  onFocus={() => {
                    setHover(t.id);
                    setCursor(`${col}:${slot.rank}`);
                  }}
                  onBlur={() => setHover(null)}
                  onClick={() => setPinned((p) => (p === t.id ? null : t.id))}
                  aria-pressed={pinned === t.id}
                  aria-label={`${ARM_SHORT[ARMS[col]]} rank ${slot.rank}: ${c?.name ?? `company ${t.id}`}, ${GRADE_NAME[g]}${known ? ", wrote the Launch HN post" : ""}`}
                  initial={reduce ? false : { opacity: 0 }}
                  animate={drawn ? { opacity: 1 } : { opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE, delay: col * 0.22 + slot.rank * 0.012 }}
                  className={`absolute rounded-[6px] px-2 text-left transition-[background-color,color] duration-[120ms] ${
                    isActive ? "bg-ink text-paper" : "hover:bg-surface"
                  }`}
                  style={{ left: colX(col), top: rowY(slot.rank) - 14, width: COL_W, height: 28 }}
                >
                  <span className="flex h-full items-center gap-2 transition-opacity duration-[120ms]" style={{ opacity: dim ? 0.3 : 1 }}>
                  <span className={`w-5 shrink-0 font-mono text-[11px] tnum ${isActive ? "text-paper/70" : "text-muted-ink"}`}>{slot.rank}</span>
                  <span className={`min-w-0 flex-1 truncate text-[14px] ${g === "0" && !isActive ? "text-muted-ink" : ""}`}>
                    {c?.name ?? `#${t.id}`}
                  </span>
                  {known ? (
                    <span className={`label shrink-0 ${isActive ? "text-paper/80" : "text-arm-jev"}`} title="Wrote the Launch HN post">
                      author
                    </span>
                  ) : null}
                  <GradeMark grade={g} />
                  </span>
                </motion.button>
              );
            }),
          )}
        </div>
      </div>

      <div className="label mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-ink">
        <span>Judge&apos;s grade</span>
        {(["2", "1", "0", "none"] as const).map((g) => (
          <span key={g} className="inline-flex items-center gap-2">
            <svg width={22} height={8} aria-hidden>
              <line x1={1} x2={21} y1={4} y2={4} stroke="var(--ink)" strokeWidth={GRADE_STYLE[g].width} strokeOpacity={GRADE_STYLE[g].opacity} strokeLinecap="round" />
            </svg>
            <GradeMark grade={g} />
            {GRADE_NAME[g]}
          </span>
        ))}
        <span className="basis-full sm:basis-auto">Hover, focus or tap a company to follow it across columns.</span>
      </div>

      <ExplorerTable query={query} companies={companies} />
    </figure>
  );
}

function GradeMark({ grade }: { grade: keyof typeof GRADE_STYLE }) {
  return (
    <svg width={9} height={9} viewBox="0 0 10 10" className="shrink-0" aria-hidden>
      {grade === "2" ? <circle cx={5} cy={5} r={4} fill="currentColor" /> : null}
      {grade === "1" ? (
        <>
          <circle cx={5} cy={5} r={3.5} fill="none" stroke="currentColor" strokeWidth={1.2} />
          <path d="M5,1.5 A3.5,3.5 0 0 1 5,8.5 Z" fill="currentColor" />
        </>
      ) : null}
      {grade === "0" ? <circle cx={5} cy={5} r={3.5} fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.6} /> : null}
      {grade === "none" ? <line x1={2} x2={8} y1={5} y2={5} stroke="currentColor" strokeWidth={1.2} opacity={0.5} /> : null}
    </svg>
  );
}

function ExplorerTable({ query, companies }: { query: ExplorerQuery; companies: Record<number, ExplorerCompany> }) {
  return (
    <div className="sr-only">
    <table>
      <caption>{`Top 10 per reranker for the query: ${query.text}`}</caption>
      <thead>
        <tr>
          <th scope="col">Rank</th>
          {ARMS.map((a) => (
            <th key={a} scope="col">
              {ARM_SPEC[a].label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: TOP }, (_, r) => (
          <tr key={r}>
            <th scope="row">{r + 1}</th>
            {ARMS.map((a) => {
              const list = query.rankings[a];
              if (!list) return <td key={a}>not run yet</td>;
              const e = list[r];
              return <td key={a}>{e ? `${companies[e.id]?.name ?? e.id} (${GRADE_NAME[gradeKey(e.grade)]})` : ""}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
