import { ARMS, INTENTS, POSITION_BAND, type Formulation, type Results, type Verdict } from "@/lib/domain";
import { int, metric, ms, pct, times, usd } from "@/lib/format";
import { ArmName, armLabel, armOf, Swatch } from "./arms";

export function SyntheticBanner() {
  return (
    <div className="sticky top-0 z-20 bg-ink text-paper">
      <p className="label mx-auto max-w-[1100px] px-4 py-2 text-[12px] sm:px-8">
        Synthetic data for layout only. These are not results.
      </p>
    </div>
  );
}

function snapshotDate(snapshot: string): string | null {
  return /(\d{4}-\d{2}-\d{2})/.exec(snapshot)?.[1] ?? null;
}

interface Headline {
  key: string;
  jevOwnsKey: boolean;
  before: string;
  after: string;
}

function headline(results: Results): Headline {
  const jev = armOf(results, "jev");
  const haiku = armOf(results, "haiku");
  if (jev && haiku && h1Decided(results)) {
    const share = jev.overall.ndcg10.mean / haiku.overall.ndcg10.mean;
    const speed = haiku.speed.p50Ms / jev.speed.p50Ms;
    const jc = jev.speed.costPer1kUsd;
    const hc = haiku.speed.costPer1kUsd;
    const clauses: string[] = [];
    if (Number.isFinite(speed) && speed > 0) clauses.push(speed >= 1 ? `${times(speed)} the speed` : `${times(1 / speed)} the latency`);
    if (jc !== null && hc !== null && jc > 0) clauses.push(hc >= jc ? `${times(hc / jc)} lower cost` : `${times(jc / hc)} the cost`);
    return {
      key: pct(share),
      jevOwnsKey: true,
      before: "Jev reached",
      after: `of Claude Haiku’s ranking quality${clauses.length ? ` at ${clauses.join(" and ")}` : ""}.`,
    };
  }
  // Until enough queries are graded, lead with the judge-free check: it needs no grader and covers every Launch HN query.
  const none = armOf(results, "none");
  const firsts = (ranks: (number | null)[]) => ranks.filter((r) => r === 1).length;
  if (jev && jev.knownItemRanks.length) {
    const n = jev.knownItemRanks.length;
    const baseline = none?.knownItemRanks.length === n ? ` Without reranking: ${firsts(none.knownItemRanks)}.` : "";
    return {
      key: `${firsts(jev.knownItemRanks)}/${n}`,
      jevOwnsKey: true,
      before: "Given only the words of a Launch HN post, Jev ranked the company that wrote it first in",
      after: `posts.${baseline}`,
    };
  }
  if (jev) {
    return { key: metric(jev.overall.ndcg10.mean), jevOwnsKey: true, before: "Jev scored an nDCG@10 of", after: "The Claude Haiku run it is measured against is still pending." };
  }
  const best = [...results.arms].sort((a, b) => b.overall.ndcg10.mean - a.overall.ndcg10.mean)[0];
  if (best) {
    return {
      key: metric(best.overall.ndcg10.mean),
      jevOwnsKey: false,
      before: `The Jev run is pending. So far ${armLabel(best.arm)} leads with an nDCG@10 of`,
      after: "",
    };
  }
  return { key: "—", jevOwnsKey: false, before: "No reranker has been run yet.", after: "" };
}

const h1Decided = (results: Results) => results.hypotheses.some((h) => h.id === "H1" && h.verdict !== "pending");

const missed = (results: Results) => {
  const ranks = armOf(results, "jev")?.knownItemRanks;
  return ranks?.length ? ranks.filter((r) => r === null).length : null;
};

export function Hero({ results }: { results: Results }) {
  const h = headline(results);
  const queries = INTENTS.reduce((s, i) => s + results.queryCounts[i], 0);
  const date = snapshotDate(results.snapshot);
  const graded = Math.min(...["jev", "haiku"].map((a) => armOf(results, a as "jev" | "haiku")?.overall.n ?? Infinity));
  return (
    <header className="pt-14 pb-16 sm:pt-20 sm:pb-24">
      <p className="label text-muted-ink">Can Jev replace an LLM reranker?</p>
      <p
        className={`mt-6 font-mono leading-[0.9] font-medium tracking-[-0.04em] ${h.jevOwnsKey ? "text-arm-jev" : "text-ink"}`}
        style={{ fontSize: "clamp(88px, 19vw, 208px)" }}
        aria-hidden
      >
        {h.key}
      </p>
      <h1 className="narrow mt-6 max-w-[24ch] sm:mt-12 text-[30px] leading-[1.1] font-semibold text-ink sm:text-[44px]">
        {h.before} <span className="font-mono text-[0.86em] tracking-[-0.02em]">{h.key.replace("/", " of ")}</span> {h.after}
      </h1>
      {!h1Decided(results) && missed(results) !== null ? (
        <p className="mt-5 max-w-[60ch] font-serif text-[17px] leading-snug text-muted-ink">
          In {int(missed(results)!)} of those posts retrieval never put the company in the 100 candidates, so no reranker
          could find it. The graded comparison with Claude Haiku is pending until 20 or more queries are graded.
        </p>
      ) : null}
      {h1Decided(results) && results.judgeAgreement === null ? (
        <p className="mt-5 max-w-[60ch] font-serif text-[17px] leading-snug text-muted-ink">
          Every grade so far comes from Claude Opus. The human check of that grader has not been done yet, so treat the
          quality numbers as provisional.
        </p>
      ) : null}
      {h1Decided(results) && Number.isFinite(graded) && graded < 0.9 * queries ? (
        <p className="mt-5 max-w-[60ch] font-serif text-[17px] leading-snug text-muted-ink">
          Early number: it rests on {int(graded)} of {int(queries)} queries graded so far, and will move as grading finishes.
        </p>
      ) : null}
      <p className="label mt-8 flex flex-wrap gap-x-3 gap-y-1 text-muted-ink">
        <span>{int(queries)} test queries</span>
        <span className="text-rule">·</span>
        <span>{int(results.gradedPairs)} graded pairs</span>
        {date ? (
          <>
            <span className="text-rule">·</span>
            <span>YC snapshot {date}</span>
          </>
        ) : null}
        <span className="text-rule">·</span>
        <span>judge: Claude Opus</span>
      </p>
    </header>
  );
}

const STEPS = [
  { name: "query", note: "a sentence someone wrote on Hacker News" },
  { name: "route", note: "pick an intent: competitors, products, jobs or open source" },
  { name: "filter", note: "hard filters from that intent, e.g. hiring only" },
  { name: "retrieve 100", note: "BM25 + embeddings, frozen once for every reranker" },
  { name: "rerank", note: "the only step that changes", arms: true },
  { name: "top 10", note: "what gets graded" },
];

export function SetupDiagram() {
  return (
    <figure>
      <ol className="grid gap-px overflow-hidden rounded-[10px] border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1.45fr_1fr]">
        {STEPS.map((s, i) => (
          <li key={s.name} className={`relative flex flex-col gap-2 p-4 ${s.arms ? "bg-surface" : "bg-paper"}`}>
            <span className="label text-muted-ink">{i + 1}</span>
            <span className={`narrow text-[19px] font-semibold ${s.arms ? "text-arm-jev" : "text-ink"}`}>{s.name}</span>
            <span className="text-[13.5px] leading-snug text-muted-ink">{s.note}</span>
            {s.arms ? (
              <span className="mt-1 flex flex-col gap-1">
                {ARMS.map((a) => (
                  <span key={a} className="inline-flex items-center gap-2 text-[13.5px] whitespace-nowrap text-ink">
                    <Swatch arm={a} />
                    {armLabel(a)}
                  </span>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <figcaption className="sr-only">
        The pipeline: query, route, filter, retrieve 100 candidates, rerank, top 10. Only the rerank step differs between
        the four rerankers.
      </figcaption>
    </figure>
  );
}

export function Pilots({ results }: { results: Results }) {
  const pilots = (["jev", "haiku"] as const).flatMap((arm) => {
    const pilot = results.pilots[arm];
    return pilot ? [{ arm, pilot }] : [];
  });
  if (!pilots.length) return null;
  return (
    <div className="mt-10">
      <p className="prose-paper text-ink">
        Jev and Claude Haiku can each be asked two ways, and both got the same treatment: a pilot on{" "}
        {int(pilots[0].pilot.queries)} held-out dev queries, never reported as results, picked one formulation per model
        by nDCG@10, with latency breaking near-ties. Every number below uses the pick.
      </p>
      {pilots.map(({ arm, pilot }) => (
        <div key={arm} className="relative -mx-4 mt-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <caption className="label pb-2 text-left text-ink">
              <ArmName arm={arm} />
            </caption>
            <thead>
              <tr className="label border-b border-rule text-muted-ink">
                <th scope="col" className="py-2 pr-4 font-normal">Formulation</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">nDCG@10</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">p50</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Per 1,000</th>
                <th scope="col" className="py-2 text-right font-normal">Requests per search</th>
              </tr>
            </thead>
            <tbody className="font-mono text-[13px] tnum whitespace-nowrap">
              {pilot.rows.map((r) => (
                <tr key={r.formulation} className="border-b border-rule">
                  <th scope="row" className="py-3 pr-4 font-sans text-[15px] font-normal text-ink">
                    <span className="font-medium">{r.description}</span>
                    {r.formulation === pilot.chosen ? <span className="label ml-2 rounded-full bg-ink px-2 py-px text-paper">chosen</span> : null}
                  </th>
                  <td className="py-3 pr-4 text-right">{metric(r.ndcg10)}</td>
                  <td className="py-3 pr-4 text-right">{ms(r.p50Ms)}</td>
                  <td className="py-3 pr-4 text-right">{usd(r.costPer1kUsd)}</td>
                  <td className="py-3 text-right">{int(r.requestsPerSearch)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const VERDICT: Record<Verdict, { label: string; className: string }> = {
  supported: { label: "Supported", className: "bg-ink text-paper border-ink" },
  rejected: { label: "Rejected", className: "border-ink text-ink" },
  pending: { label: "Pending", className: "border-rule text-muted-ink border-dashed" },
};

export function Hypotheses({ results }: { results: Results }) {
  return (
    <ol className="border-t border-rule">
      {results.hypotheses.map((h) => {
        const v = VERDICT[h.verdict];
        return (
          <li key={h.id} className="grid gap-x-6 gap-y-2 border-b border-rule py-5 sm:grid-cols-[3rem_minmax(0,1fr)_7.5rem]">
            <span className="label pt-1 text-muted-ink">{h.id}</span>
            <div>
              <p className="font-serif text-[18px] leading-snug text-ink">{h.statement}</p>
              <p className="label mt-2 text-muted-ink">{h.evidence}</p>
            </div>
            <span className={`label h-fit w-fit rounded-full border px-2.5 py-1 sm:justify-self-end ${v.className}`}>{v.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Trust({ results }: { results: Results }) {
  const ja = results.judgeAgreement;
  const haiku = armOf(results, "haiku");
  return (
    <div className="prose-paper text-ink">
      <p>
        Every quality number above comes from one grader: Claude Opus, reading each query with 20 pooled companies at a
        time and grading them 0 (irrelevant), 1 (partial) or 2 (exact). It never saw which reranker found a company.
      </p>
      {ja ? (
        <p>
          To check it, a person graded {int(ja.n)} of the same pairs by hand. The judge gave the same grade{" "}
          <strong className="font-mono text-[0.85em] font-normal">{pct(ja.exact)}</strong> of the time and was within one
          grade <strong className="font-mono text-[0.85em] font-normal">{pct(ja.within1)}</strong> of the time (Cohen&apos;s
          κ <strong className="font-mono text-[0.85em] font-normal">{ja.kappa.toFixed(2)}</strong>).
        </p>
      ) : (
        <p className="text-muted-ink">The hand-graded check of the judge has not been run yet.</p>
      )}
      <p>
        <strong className="font-semibold">A Claude judge may favour a Claude reranker.</strong>{" "}
        {haiku
          ? "Read Claude Haiku's lead against the judge-free check in section 6: that chart uses no grader at all, so if Haiku's lead shrinks there, the judge is the likely reason."
          : "The judge-free check in section 6 is there to catch this."}
      </p>
      <p className="font-sans text-[15px] font-semibold">Limitations</p>
      <ul className="list-disc space-y-1.5 pl-5 marker:text-rule">
        <li>
          Queries come from Hacker News. They skew technical and toward developer tools, so the product and open-source
          intents are easier to fill than they would be on a general site.
        </li>
        <li>
          Founder search is not tested. The YC directory mirror has no founder data, and Jev has no founder intent here.
        </li>
        <li>Retrieval is held fixed. A reranker cannot recover a company retrieval missed, so every arm shares that ceiling.</li>
        <li>
          Latency to a hosted API is mostly network. Claude Haiku ran through Claude Code, so its latency is API time
          reported by Claude Code, close to but not the same as calling the API directly. When a search sends several
          Haiku prompts at once, its latency is the slowest prompt&apos;s.
        </li>
        <PositionDecayLimitation results={results} />
        <li>
          The live search does not retrieve quite the way the benchmark did. Every number here used fp32 query
          embeddings; the deployed app uses the q8 weights, because the fp32 file is 133 MB and a serverless function
          has 250 MB for everything it needs. Across the 200 test queries the two agree on a median{" "}
          <span className="font-mono text-[0.85em]">96%</span> of the retrieved 100 and{" "}
          <span className="font-mono text-[0.85em]">90%</span> of the top 10, and they disagree on the first result for{" "}
          <span className="font-mono text-[0.85em]">8.5%</span> of queries. In this page&apos;s own currency, q8 drops{" "}
          <span className="font-mono text-[0.85em]">13</span> of the{" "}
          <span className="font-mono text-[0.85em]">910</span> grade-2 companies out of the top 100 and costs nothing on
          the Launch HN check. Rerun it with <span className="font-mono text-[0.85em]">bun run bench:embed-drift</span>.
        </li>
        <li>
          If the embedding model fails to load, the live search ranks with BM25 alone and says so under the results.
          Nothing on this page is measured that way, and it is not a free fallback: grade-2 companies reaching the top
          100 falls from <span className="font-mono text-[0.85em]">910/910</span> to{" "}
          <span className="font-mono text-[0.85em]">709/910</span>, and the Launch HN company is found in{" "}
          <span className="font-mono text-[0.85em]">33</span> of 50 queries instead of{" "}
          <span className="font-mono text-[0.85em]">37</span>.
        </li>
        <li>Costs use each provider&apos;s published list price on the run date.</li>
      </ul>
    </div>
  );
}

const DECAY_LABEL: Record<Formulation, string> = {
  batch_100: "Claude Haiku with all 100 cards in one prompt",
  batch_10: "Claude Haiku with ten prompts of 10 cards",
  fan_out: "Jev",
  per_pair: "Jev asked once per card",
};

function PositionDecayLimitation({ results }: { results: Results }) {
  const rows = results.positionDecay;
  if (!rows.some((d) => d.arm === "haiku")) return null;
  const bands = rows[0].r.map((_, i) => `${i * POSITION_BAND + 1}–${(i + 1) * POSITION_BAND}`);
  const relevant = rows[0].relevant;
  return (
    <li>
      Agreement with the judge depends on where a card sat in the retrieval list. Correlation of each score with the
      judge&apos;s grade, for retrieval positions {bands.join(", ")}:{" "}
      {rows.map((d, i) => (
        <span key={`${d.arm}-${d.formulation}`}>
          {i ? "; " : ""}
          {DECAY_LABEL[d.formulation]} <span className="font-mono text-[0.85em]">{d.r.map(metric).join(", ")}</span>
        </span>
      ))}
      . The share of relevant cards barely moves across those bands ({relevant.map(metric).join(", ")}), so a falling
      correlation comes from the reranker, not the candidates. A 100-card prompt loses Haiku most of its agreement past
      the first 25 cards; ten cards per prompt, the formulation its pilot picked, keeps most of it.
    </li>
  );
}

const COMMANDS = `git clone https://github.com/PPRAMANIK62/yc-jev-bench && cd yc-jev-bench
bun install
cp .env.example .env        # add TYPESAFE_API_KEY for the Jev arm
bun bench/index.ts          # build the retrieval index from the frozen snapshot
bun run bench               # every arm and router, the Opus judge, then src/generated/results.json
bun run dev                 # open this report and the search at localhost:3000`;

export function Reproduce() {
  return (
    <div>
      <p className="prose-paper text-ink">
        The data snapshot, queries, labels and prompts are in the repository. Retrieval is frozen once, so every arm
        reranks the identical 100 candidates.
      </p>
      <pre className="mt-6 overflow-x-auto rounded-[10px] border border-rule bg-surface p-5 font-mono text-[12.5px] leading-[1.9] text-ink">
        <code>{COMMANDS}</code>
      </pre>
    </div>
  );
}
