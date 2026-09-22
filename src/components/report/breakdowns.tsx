import { ARMS, INTENT_LABEL, INTENTS, type ArmId, type Results } from "@/lib/domain";
import { metric, ms, usd } from "@/lib/format";
import { ARM_COLOR, ARM_SHORT, armLabel, armOf, routerOf, Swatch } from "./arms";
import { Appear, AppearBlock, DrawPath, Figure, GrowRect } from "./draw";
import { IntervalBar } from "./quality";
import { linear, log } from "./scale";
import { Caption } from "./section";

export function ByIntent({ results }: { results: Results }) {
  return (
    <Figure>
      <div className="grid gap-x-8 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
        {INTENTS.map((intent, p) => (
          <div key={intent} className="min-w-0">
            <div className="flex items-baseline justify-between border-b border-rule pb-2">
              <h3 className="narrow text-[18px] font-semibold text-ink">{INTENT_LABEL[intent]}</h3>
              <span className="label text-muted-ink">{results.queryCounts[intent]} queries</span>
            </div>
            <table className="mt-3 w-full border-collapse">
              <caption className="sr-only">{`nDCG@10 by reranker for ${INTENT_LABEL[intent]} queries`}</caption>
              <tbody>
                {ARMS.map((arm, i) => {
                  const m = armOf(results, arm)?.byIntent[intent];
                  return (
                    <tr key={arm}>
                      <th scope="row" className="label w-[3.75rem] py-1.5 pr-2 text-left font-normal text-ink">
                        {ARM_SHORT[arm]}
                      </th>
                      {m ? (
                        <>
                          <td className="py-1.5">
                            <IntervalBar iv={m.ndcg10} color={ARM_COLOR[arm]} delay={p * 0.08 + i * 0.05} width={112} />
                          </td>
                          <td className="w-[2.5rem] py-1.5 text-right font-mono text-[12px] tnum text-ink">
                            {metric(m.ndcg10.mean)}
                            <span className="sr-only">{`, 95% interval ${metric(m.ndcg10.lo)} to ${metric(m.ndcg10.hi)}`}</span>
                          </td>
                        </>
                      ) : (
                        <td colSpan={2} className="py-1.5">
                          <span className="label text-muted-ink">
                            <span aria-hidden className="mr-2 inline-block h-2 w-2 rounded-full opacity-35" style={{ background: ARM_COLOR[arm] }} />
                            not run yet
                          </span>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <Caption>nDCG@10 per intent, every panel on the same 0–1 scale, with 95% intervals.</Caption>
    </Figure>
  );
}

const KW = 640;
const KH = 60;
const KM = { l: 8, r: 92 };
const OUTSIDE_X = KW - 40;

function knownStats(ranks: (number | null)[]) {
  const found = ranks.filter((r): r is number => r !== null).sort((a, b) => a - b);
  const all = ranks.map((r) => r ?? Infinity).sort((a, b) => a - b);
  const mid = all.length ? all[Math.floor((all.length - 1) / 2)] : Infinity;
  return {
    n: ranks.length,
    first: found.filter((r) => r === 1).length,
    top10: found.filter((r) => r <= 10).length,
    median: mid,
  };
}

function stack(ranks: (number | null)[], x: (r: number) => number) {
  const columns = new Map<number, number>();
  return ranks.map((r) => {
    const cx = r === null ? OUTSIDE_X : Math.round(x(r));
    const k = columns.get(cx) ?? 0;
    columns.set(cx, k + 1);
    return { cx, k };
  });
}

export function KnownItem({ results }: { results: Results }) {
  const x = log([1, 100], [KM.l + 6, KW - KM.r - 24]);
  const ran = ARMS.filter((a) => armOf(results, a));
  if (ran.length === 0) return null;
  return (
    <Figure>
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="min-w-[720px]">
          {ARMS.map((arm, row) => {
            const r = armOf(results, arm);
            return (
              <div key={arm} className="grid grid-cols-[10rem_minmax(0,1fr)_12.5rem] items-center gap-4 border-b border-rule py-2">
                <span className="inline-flex items-center gap-2 text-[15px] font-medium text-ink">
                  <Swatch arm={arm} />
                  {armLabel(arm)}
                </span>
                {r ? <Strip ranks={r.knownItemRanks} arm={arm} x={x} delay={row * 0.1} /> : <span className="label text-muted-ink">not run yet</span>}
                {r ? <StatLine ranks={r.knownItemRanks} /> : <span />}
              </div>
            );
          })}
          <div className="grid grid-cols-[10rem_minmax(0,1fr)_12.5rem] gap-4 pt-2">
            <span />
            <svg viewBox={`0 0 ${KW} 16`} className="block w-full" aria-hidden>
              {[1, 2, 3, 5, 10, 20, 50, 100].map((t) => (
                <text key={t} x={x(t)} y={11} textAnchor="middle" className="fill-muted-ink font-mono text-[11px]">
                  #{t}
                </text>
              ))}
              <text x={OUTSIDE_X} y={11} textAnchor="middle" className="fill-muted-ink font-mono text-[11px]">
                not in 100
              </text>
            </svg>
            <span />
          </div>
        </div>
      </div>
      <Caption>
        One dot per Launch HN query: where each reranker placed the company that wrote the post. Rank is on a log scale,
        so the left edge is the top result. No judge is involved in this chart.
      </Caption>
    </Figure>
  );
}

function Strip({ ranks, arm, x, delay }: { ranks: (number | null)[]; arm: ArmId; x: (r: number) => number; delay: number }) {
  const dots = stack(ranks, x);
  const tallest = Math.max(1, ...dots.map((d) => d.k + 1));
  const step = Math.min(9, (KH - 12) / tallest);
  const s = knownStats(ranks);
  return (
    <svg
      viewBox={`0 0 ${KW} ${KH}`}
      className="block w-full"
      role="img"
      aria-label={`${armLabel(arm)}: ranked the launching company first in ${s.first} of ${s.n} queries and in the top 10 in ${s.top10}.`}
    >
      {[1, 10, 100].map((t) => (
        <line key={t} x1={x(t)} x2={x(t)} y1={4} y2={KH - 4} stroke="var(--rule)" />
      ))}
      <line x1={OUTSIDE_X - 22} x2={OUTSIDE_X - 22} y1={4} y2={KH - 4} stroke="var(--rule)" />
      {dots.map((d, i) => (
        <Appear key={i} delay={delay + (d.cx / KW) * 0.5}>
          <circle
            cx={d.cx}
            cy={KH - 8 - d.k * step}
            r={4}
            fill={ranks[i] === null ? "var(--paper)" : ARM_COLOR[arm]}
            stroke={ranks[i] === null ? ARM_COLOR[arm] : "var(--paper)"}
            strokeWidth={1.5}
          />
        </Appear>
      ))}
    </svg>
  );
}

function StatLine({ ranks }: { ranks: (number | null)[] }) {
  const s = knownStats(ranks);
  return (
    <p className="label leading-relaxed whitespace-nowrap text-muted-ink">
      <span className="text-ink">#1</span> in {s.first} of {s.n}, <span className="text-ink">top 10</span> in {s.top10}
      <br />
      median rank {Number.isFinite(s.median) ? `#${s.median}` : "not in 100"}
    </p>
  );
}

export function Routing({ results }: { results: Results }) {
  const routers = [
    { id: "haiku", arm: "haiku" },
    { id: "jev", arm: "jev" },
  ] as const;
  return (
    <Figure>
      <div className="grid gap-10 md:grid-cols-2">
        {routers.map(({ id, arm }, p) => {
          const r = routerOf(results, id);
          return (
            <div key={id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2">
                <h3 className="inline-flex items-center gap-2 text-[16px] font-semibold text-ink">
                  <Swatch arm={arm} />
                  {id === "jev" ? "Jev Choice" : armLabel(arm)}
                </h3>
                {r ? (
                  <span className="font-mono text-[22px] text-ink">
                    {(r.accuracy * 100).toFixed(0)}%<span className="label ml-1.5 text-muted-ink">accurate</span>
                  </span>
                ) : (
                  <span className="label text-muted-ink">not run yet</span>
                )}
              </div>
              {r ? <Confusion matrix={r.confusion} arm={arm} name={id === "jev" ? "Jev" : "Claude Haiku"} delay={p * 0.15} /> : (
                <div className="mt-4 aspect-[4/3] rounded-[10px] border border-rule opacity-40" style={{ borderColor: ARM_COLOR[arm] }} />
              )}
              {r ? (
                <p className="label mt-3 text-muted-ink">
                  {r.n} queries · median {ms(r.speed.p50Ms)}
                  {r.speed.costPer1kUsd !== null ? ` · ${usd(r.speed.costPer1kUsd)} per 1,000` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <Caption>Rows are the intent the query came from; columns are what the router picked. The diagonal is correct.</Caption>
    </Figure>
  );
}

const SHORT_INTENT = { competitor: "Comp.", product: "Product", job: "Job", open_source: "OSS" } as const;

function Confusion({ matrix, arm, name, delay }: { matrix: number[][]; arm: ArmId; name: string; delay: number }) {
  return (
    <table className="mt-4 w-full table-fixed border-separate border-spacing-[2px]">
      <caption className="sr-only">{`${name} routing confusion matrix: rows are actual intent, columns predicted`}</caption>
      <thead>
        <tr>
          <th scope="col" className="label w-[5.5rem] pb-1 text-left font-normal text-muted-ink">
            actual ↓ picked →
          </th>
          {INTENTS.map((i) => (
            <th key={i} scope="col" className="label pb-1 text-center font-normal text-muted-ink">
              {SHORT_INTENT[i]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {INTENTS.map((actual, a) => {
          const total = matrix[a].reduce((s, v) => s + v, 0) || 1;
          return (
            <tr key={actual}>
              <th scope="row" className="label pr-2 text-left font-normal text-ink">
                {SHORT_INTENT[actual]}
              </th>
              {INTENTS.map((picked, b) => {
                const v = matrix[a][b];
                const share = v / total;
                return (
                  <td key={picked} className="p-0">
                    <AppearBlock delay={delay + (a + b) * 0.04}>
                      <div
                        className="flex h-11 items-center justify-center rounded-[4px] font-mono text-[12px] tnum"
                        style={{
                          background: `color-mix(in srgb, ${ARM_COLOR[arm]} ${Math.round(8 + share * 84)}%, var(--surface))`,
                          color: share > 0.5 ? "var(--paper)" : "var(--ink)",
                          outline: a === b ? "1px solid var(--ink)" : undefined,
                          outlineOffset: -1,
                        }}
                        title={`${INTENT_LABEL[actual]} queries routed to ${INTENT_LABEL[picked]}: ${Math.round(v)}`}
                      >
                        {Math.round(v)}
                      </div>
                    </AppearBlock>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const CW = 420;
const CH = 420;
const CM = { l: 48, r: 16, t: 16, b: 96 };

export function Calibration({ results }: { results: Results }) {
  const bins = results.calibration;
  if (!bins || bins.length === 0) return null;
  const x = linear([0, 1], [CM.l, CW - CM.r]);
  const plotBottom = CH - CM.b;
  const y = linear([0, 1], [plotBottom, CM.t]);
  const maxN = Math.max(...bins.map((b) => b.n));
  const hist = linear([0, maxN], [0, 30]);
  const used = bins.filter((b) => b.n > 0);
  const total = used.reduce((s, b) => s + b.n, 0) || 1;
  const ece = used.reduce((s, b) => s + (b.n / total) * Math.abs(b.accuracy - b.meanConfidence), 0);
  const d = used.map((b, i) => `${i ? "L" : "M"}${x(b.meanConfidence)},${y(b.accuracy)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <Figure className="grid items-start gap-8 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        className="block w-full max-w-[420px]"
        role="img"
        aria-label={`Reliability diagram for Jev's routing confidence. ${used
          .map((b) => `Confidence ${b.lo.toFixed(1)}–${b.hi.toFixed(1)}: ${b.n} queries, ${(b.accuracy * 100).toFixed(0)}% correct`)
          .join("; ")}.`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(1)} stroke="var(--rule)" />
            <text x={CM.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-ink font-mono text-[11px]">
              {t}
            </text>
            <text x={x(t)} y={plotBottom + 16} textAnchor="middle" className="fill-muted-ink font-mono text-[11px]">
              {t}
            </text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--muted-ink)" strokeWidth={1} />
        <text
          x={x(0.78)}
          y={y(0.78)}
          dy={16}
          transform={`rotate(-45 ${x(0.78)} ${y(0.78)})`}
          textAnchor="middle"
          className="fill-muted-ink font-mono text-[10.5px]"
        >
          perfectly calibrated
        </text>
        <DrawPath d={d} fill="none" stroke="var(--arm-jev)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {used.map((b, i) => (
          <Appear key={i} delay={0.2 + i * 0.05}>
            <title>{`Confidence ${b.lo.toFixed(1)}–${b.hi.toFixed(1)}: ${b.n} queries, mean confidence ${b.meanConfidence.toFixed(2)}, ${(b.accuracy * 100).toFixed(0)}% correct`}</title>
            <circle cx={x(b.meanConfidence)} cy={y(b.accuracy)} r={4.5} fill="var(--arm-jev)" stroke="var(--paper)" strokeWidth={2} />
          </Appear>
        ))}
        <text x={x(0)} y={plotBottom + 34} className="fill-muted-ink font-mono text-[11px]">
          Jev&apos;s confidence →
        </text>
        <text x={CM.l - 8} y={CM.t - 6} textAnchor="start" className="fill-muted-ink font-mono text-[11px]">
          share correct
        </text>
        {bins.map((b, i) => {
          const h = hist(b.n);
          const bw = x(b.hi) - x(b.lo) - 2;
          return (
            <GrowRect key={i} vertical x={x(b.lo) + 1} y={CH - 8 - h} width={Math.max(0, bw)} height={h} rx={2} fill="var(--rule)" delay={0.1 + i * 0.03} />
          );
        })}
        <text x={CW - CM.r} y={CH - 60} textAnchor="end" className="fill-muted-ink font-mono text-[10.5px]">
          queries per bin
        </text>
      </svg>
      <div className="prose-paper text-ink">
        <p>
          Each dot is a band of confidence. Its height is how often Jev&apos;s intent was right when it reported that
          much confidence. On the diagonal, a confidence of 0.8 means right four times in five.
        </p>
        <p className="label mt-5 text-muted-ink">
          Expected calibration error <span className="font-mono text-[15px] text-ink">{ece.toFixed(3)}</span>
          <br />
          weighted mean gap between confidence and accuracy; 0 is perfect
        </p>
      </div>
    </Figure>
  );
}
