import { ARMS, type Interval, type Results } from "@/lib/domain";
import { metric } from "@/lib/format";
import { ARM_COLOR, ArmName, armLabel, armOf, NotRunYet } from "./arms";
import { Figure, GrowRect } from "./draw";
import { linear } from "./scale";
import { Caption } from "./section";

const METRICS = [
  { key: "ndcg10", label: "nDCG@10", hint: "graded ranking quality of the top 10" },
  { key: "recall10", label: "Recall@10", hint: "share of exact matches that made the top 10" },
  { key: "mrr", label: "MRR", hint: "how early the first good answer appears" },
] as const;

const W = 132;
const H = 18;

export function IntervalBar({ iv, color, delay, width = W }: { iv: Interval; color: string; delay: number; width?: number }) {
  const x = linear([0, 1], [0, width]);
  return (
    <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block overflow-visible" aria-hidden>
      <line x1={0} x2={width} y1={H / 2} y2={H / 2} stroke="var(--rule)" />
      <GrowRect x={0} y={H / 2 - 3} width={Math.max(0, x(iv.mean))} height={6} rx={3} fill={color} delay={delay} />
      <line x1={x(iv.lo)} x2={x(iv.hi)} y1={H / 2} y2={H / 2} stroke="var(--ink)" strokeWidth={1.25} />
      <line x1={x(iv.lo)} x2={x(iv.lo)} y1={H / 2 - 4.5} y2={H / 2 + 4.5} stroke="var(--ink)" strokeWidth={1.25} />
      <line x1={x(iv.hi)} x2={x(iv.hi)} y1={H / 2 - 4.5} y2={H / 2 + 4.5} stroke="var(--ink)" strokeWidth={1.25} />
    </svg>
  );
}

export function QualityTable({ results }: { results: Results }) {
  return (
    <Figure>
      <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <caption className="sr-only">
            Ranking quality per reranker, mean with 95% bootstrap interval over queries.
          </caption>
          <thead>
            <tr className="label border-b border-rule text-muted-ink">
              <th scope="col" className="py-2 pr-4 font-normal">Reranker</th>
              {METRICS.map((m) => (
                <th key={m.key} scope="col" className="py-2 pr-4 font-normal" title={m.hint}>
                  {m.label}
                </th>
              ))}
              <th scope="col" className="py-2 text-right font-normal">Queries</th>
            </tr>
          </thead>
          <tbody>
            {ARMS.map((arm, row) => {
              const r = armOf(results, arm);
              return (
                <tr key={arm} className="border-b border-rule transition-colors duration-[120ms] hover:bg-surface">
                  <th scope="row" className="py-3.5 pr-4 text-[15px] font-medium whitespace-nowrap text-ink">
                    <ArmName arm={arm} />
                  </th>
                  {r ? (
                    <>
                      {METRICS.map((m, col) => {
                        const iv = r.overall[m.key];
                        return (
                          <td key={m.key} className="py-3.5 pr-4">
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-[13px] tnum text-ink">{metric(iv.mean)}</span>
                              <IntervalBar iv={iv} color={ARM_COLOR[arm]} delay={row * 0.06 + col * 0.04} />
                            </div>
                            <span className="sr-only">
                              {`${armLabel(arm)} ${m.label} ${metric(iv.mean)}, 95% interval ${metric(iv.lo)} to ${metric(iv.hi)}`}
                            </span>
                          </td>
                        );
                      })}
                      <td className="label py-3.5 text-right text-muted-ink">{r.overall.n}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="py-3.5">
                      <NotRunYet arm={arm} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Caption>
        Bars run from 0 to the mean on a 0–1 scale. The black whisker is the 95% bootstrap interval over queries: where
        two whiskers overlap, the gap between those rerankers may be noise.
      </Caption>
    </Figure>
  );
}
