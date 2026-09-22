import type { Metadata } from "next";
import { ByIntent, Calibration, KnownItem, Routing } from "@/components/report/breakdowns";
import { Explorer } from "@/components/report/explorer";
import { Hero, Hypotheses, Pilots, Reproduce, SetupDiagram, SyntheticBanner, Trust } from "@/components/report/prose";
import { QualityTable } from "@/components/report/quality";
import { Pending, Section } from "@/components/report/section";
import { SpeedScatter, SpeedTable } from "@/components/report/speed";
import { loadResults } from "@/lib/results";

export const metadata: Metadata = {
  title: { absolute: "Can Jev replace an LLM reranker?" },
  description: "An independent benchmark of TypeSafe's Jev as a search reranker and intent router, on all 6,245 YC companies.",
};

export default function ReportPage() {
  const results = loadResults();
  if (!results) {
    return (
      <main className="mx-auto w-full max-w-[1100px] px-4 py-24 sm:px-8">
        <h1 className="narrow text-[40px] font-semibold text-ink">Can Jev replace an LLM reranker?</h1>
        <p className="prose-paper mt-4 text-muted-ink">The benchmark hasn&apos;t produced results yet.</p>
      </main>
    );
  }

  const launchHn = results.arms.some((a) => a.knownItemRanks.length > 0);

  return (
    <>
      {results.synthetic ? <SyntheticBanner /> : null}
      <main className="mx-auto w-full max-w-[1100px] px-4 sm:px-8">
        <Hero results={results} />

        <Section
          id="setup"
          n={2}
          title="The setup"
          lede={
            <>
              <p>
                Jev is not a search engine. It answers typed questions about a situation with a choice or a score, and a
                confidence. So the test puts it where a search stack already asks those questions: picking what the user
                wants, and scoring 100 retrieved candidates against the query.
              </p>
              <p>
                Retrieval is held fixed. Every reranker scores the identical 100 companies, so any difference below is the
                reranker&apos;s alone.
              </p>
            </>
          }
        >
          <SetupDiagram />
          <Pilots results={results} />
        </Section>

        <Section
          id="quality"
          n={3}
          title="Ranking quality"
          lede={<p>How good is the top 10 each reranker puts in front of the user, graded against the judge&apos;s labels.</p>}
        >
          <QualityTable results={results} />
        </Section>

        <Section
          id="speed"
          n={4}
          title="Speed and cost"
          lede={<p>Jev&apos;s pitch is speed and price. Here is what each reranker costs in time and money for the quality it buys.</p>}
        >
          <SpeedScatter results={results} />
          <SpeedTable results={results} />
        </Section>

        <Section
          id="intents"
          n={5}
          title="By intent"
          lede={<p>A reranker that wins on competitor searches and loses on job searches is a finding, so each intent gets its own panel.</p>}
        >
          <ByIntent results={results} />
        </Section>

        <Section
          id="known-item"
          n={6}
          title="The judge-free check"
          lede={
            <p>
              Launch HN posts come with a correct answer: the company that wrote the post. Its rank needs no grader, which
              makes this the most trustworthy chart on the page.
            </p>
          }
        >
          {launchHn ? <KnownItem results={results} /> : <Pending>Not run yet: no Launch HN queries have been scored.</Pending>}
        </Section>

        <Section
          id="routing"
          n={7}
          title="Routing"
          lede={<p>Before retrieval, the query is routed to one of four intents. Jev Choice and Claude Haiku got the same queries and the same list.</p>}
        >
          <Routing results={results} />
        </Section>

        <Section
          id="calibration"
          n={8}
          title="Does Jev’s confidence mean anything?"
          lede={
            <p>
              Jev returns a confidence with every answer. If it is honest, a product could act on it: skip the expensive
              step when Jev is sure, ask the user when it isn&apos;t.
            </p>
          }
        >
          {results.calibration && results.calibration.length > 0 ? (
            <Calibration results={results} />
          ) : (
            <Pending>Not run yet: Jev routing confidences haven&apos;t been collected.</Pending>
          )}
        </Section>

        <Section
          id="hypotheses"
          n={9}
          title="What we expected, and what held"
          lede={<p>Written down before anything ran.</p>}
        >
          <Hypotheses results={results} />
        </Section>

        <Section
          id="explorer"
          n={10}
          title="Look at the rankings yourself"
          lede={
            <p>
              Pick a query and follow each company from retrieval order to each reranker&apos;s top 10. Heavier threads are
              better matches by the judge&apos;s grade.
            </p>
          }
          wide
        >
          <Explorer queries={results.explorer.queries} companies={results.explorer.companies} />
        </Section>

        <Section id="trust" n={11} title="How much to trust this">
          <Trust results={results} />
        </Section>

        <Section id="reproduce" n={12} title="Reproduce it">
          <Reproduce />
        </Section>
      </main>
    </>
  );
}
