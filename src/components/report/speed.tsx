import { ARM_SPEC, ARMS, type ArmResult, type Results } from "@/lib/domain";
import { metric, ms, usd } from "@/lib/format";
import { ARM_COLOR, ARM_SHORT, ArmName, armLabel, armOf, NotRunYet } from "./arms";
import { Appear, DrawPath, Figure } from "./draw";
import { decadesAround, decadeTicks, linear, log } from "./scale";
import { Caption } from "./section";

const W = 720;
const H = 380;
const M = { l: 52, r: 24, t: 34, b: 44 };

function tickLabel(v: number): string {
  return v >= 1000 ? `${v / 1000} s` : `${v} ms`;
}

export function SpeedScatter({ results }: { results: Results }) {
  const ran = ARMS.map((a) => armOf(results, a)).filter((r): r is ArmResult => r !== null);
  const timed = ran.filter((r) => r.speed.p50Ms > 0);
  const untimed = ran.filter((r) => r.speed.p50Ms <= 0);
  if (ran.length === 0) return null;

  const xDomain = timed.length ? decadesAround(timed.map((r) => r.speed.p50Ms)) : ([10, 10_000] as [number, number]);
  if (xDomain[0] === xDomain[1]) xDomain[1] *= 10;
  const x = log(xDomain, [M.l, W - M.r]);
  const lo = Math.max(0, Math.floor(Math.min(...ran.map((r) => r.overall.ndcg10.lo)) * 10) / 10 - 0.1);
  const hi = Math.min(1, Math.ceil(Math.max(...ran.map((r) => r.overall.ndcg10.hi)) * 10) / 10 + 0.05);
  const y = linear([lo, hi], [H - M.b, M.t]);
  const yTicks = Array.from({ length: Math.round((hi - lo) / 0.1) + 1 }, (_, i) => +(lo + i * 0.1).toFixed(1)).filter((t) => t <= hi);

  const summary = ran
    .map((r) => `${armLabel(r.arm)}: nDCG@10 ${metric(r.overall.ndcg10.mean)}, p50 ${r.speed.p50Ms > 0 ? ms(r.speed.p50Ms) : "no added latency"}`)
    .join("; ");

  return (
    <Figure>
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[560px]" role="img" aria-label={`Ranking quality against median latency. ${summary}.`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
              <text x={M.l - 10} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-ink font-mono text-[11px] tnum">
                {t.toFixed(1)}
              </text>
            </g>
          ))}
          {decadeTicks(xDomain).map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t} y2={H - M.b} stroke="var(--rule)" />
              <text x={x(t)} y={H - M.b + 20} textAnchor="middle" className="fill-muted-ink font-mono text-[11px]">
                {tickLabel(t)}
              </text>
            </g>
          ))}
          <text x={W - M.r} y={H - 4} textAnchor="end" className="fill-muted-ink font-mono text-[11px]">
            median latency per search, log scale →
          </text>
          <text x={0} y={12} className="fill-muted-ink font-mono text-[11px]">
            nDCG@10 ↑
          </text>

          {untimed.map((r) => (
            <g key={r.arm}>
              <DrawPath
                d={`M${M.l},${y(r.overall.ndcg10.mean)}H${W - M.r}`}
                stroke={ARM_COLOR[r.arm]}
                strokeWidth={1.5}
                fill="none"
              />
              <Appear delay={0.5}>
                <text x={M.l + 8} y={y(r.overall.ndcg10.mean) - 8} className="fill-ink font-sans text-[13px]">
                  {armLabel(r.arm)}
                  <tspan className="fill-muted-ink font-mono text-[11px]">{`  ${metric(r.overall.ndcg10.mean)} · adds no latency`}</tspan>
                </text>
              </Appear>
            </g>
          ))}

          {timed.map((r, i) => {
            const cx = x(r.speed.p50Ms);
            const iv = r.overall.ndcg10;
            const right = cx < W - 190;
            return (
              <Appear key={r.arm} delay={0.15 + i * 0.08}>
                <title>{`${armLabel(r.arm)}: nDCG@10 ${metric(iv.mean)} (${metric(iv.lo)}–${metric(iv.hi)}), p50 ${ms(r.speed.p50Ms)}`}</title>
                <line x1={cx} x2={cx} y1={y(iv.lo)} y2={y(iv.hi)} stroke="var(--ink)" strokeWidth={1.25} />
                <line x1={cx - 4} x2={cx + 4} y1={y(iv.lo)} y2={y(iv.lo)} stroke="var(--ink)" strokeWidth={1.25} />
                <line x1={cx - 4} x2={cx + 4} y1={y(iv.hi)} y2={y(iv.hi)} stroke="var(--ink)" strokeWidth={1.25} />
                <circle cx={cx} cy={y(iv.mean)} r={r.arm === "jev" ? 7 : 5.5} fill={ARM_COLOR[r.arm]} stroke="var(--paper)" strokeWidth={2} />
                <text
                  x={right ? cx + 14 : cx - 14}
                  y={y(iv.mean)}
                  dy="-0.15em"
                  textAnchor={right ? "start" : "end"}
                  className="fill-ink font-sans text-[14px] font-medium"
                >
                  {ARM_SHORT[r.arm]}
                </text>
                <text
                  x={right ? cx + 14 : cx - 14}
                  y={y(iv.mean)}
                  dy="1.2em"
                  textAnchor={right ? "start" : "end"}
                  className="fill-muted-ink font-mono text-[11px] tnum"
                >
                  {`${metric(iv.mean)} · ${ms(r.speed.p50Ms)}`}
                </text>
              </Appear>
            );
          })}
        </svg>
      </div>
      <Caption>
        Up is better ranking, left is faster. Whiskers are 95% intervals on nDCG@10. Latency is the median per search of
        100 candidates. A reranker that adds no step is drawn as a line: anything below it made results worse.
      </Caption>
    </Figure>
  );
}

function basis(r: ArmResult): string {
  if (r.speed.p50Ms <= 0) return "no rerank step";
  if (ARM_SPEC[r.arm].runsWhere === "claude-code") return "API time, via Claude Code";
  return r.speed.latencyBasis === "api" ? "API time" : "wall clock";
}

export function SpeedTable({ results }: { results: Results }) {
  return (
    <div className="relative -mx-4 mt-10 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <caption className="sr-only">Latency and cost per reranker</caption>
        <thead>
          <tr className="label border-b border-rule text-muted-ink">
            <th scope="col" className="py-2 pr-4 font-normal">Reranker</th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">p50</th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">p99</th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">Per 1k searches</th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">At 1M a month</th>
            <th scope="col" className="py-2 font-normal">Latency measured as</th>
          </tr>
        </thead>
        <tbody className="font-mono text-[13px] tnum whitespace-nowrap">
          {ARMS.map((arm) => {
            const r = armOf(results, arm);
            if (!r) {
              return (
                <tr key={arm} className="border-b border-rule">
                  <th scope="row" className="py-3 pr-4 font-sans text-[15px] font-medium text-ink">
                    <ArmName arm={arm} />
                  </th>
                  <td colSpan={5} className="py-3">
                    <NotRunYet />
                  </td>
                </tr>
              );
            }
            const cost = r.speed.costPer1kUsd;
            const local = ARM_SPEC[arm].runsWhere === "local";
            return (
              <tr key={arm} className="border-b border-rule transition-colors duration-[120ms] hover:bg-surface">
                <th scope="row" className="py-3 pr-4 font-sans text-[15px] font-medium whitespace-nowrap text-ink">
                  <ArmName arm={arm} />
                </th>
                <td className="py-3 pr-4 text-right">{r.speed.p50Ms > 0 ? ms(r.speed.p50Ms) : "—"}</td>
                <td className="py-3 pr-4 text-right">{r.speed.p99Ms > 0 ? ms(r.speed.p99Ms) : "—"}</td>
                <td className="py-3 pr-4 text-right">{cost !== null ? usd(cost) : local ? "runs locally" : "—"}</td>
                <td className={`py-3 pr-4 text-right ${arm === "jev" ? "font-semibold" : ""}`}>
                  {cost !== null ? usd(cost * 1000) : local ? "your hardware" : "—"}
                </td>
                <td className="label py-3 text-muted-ink">{basis(r)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
