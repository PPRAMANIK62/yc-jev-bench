# Can Jev replace an LLM reranker?

A benchmark of TypeSafe's Jev on a real search problem: natural-language search over every YC company. The search app is the demo. The numbers are the product.

Working title for the post: **"Can Jev replace an LLM reranker? I tested it on 6,245 YC companies."**

## Why this experiment

Jev launched on 2026-09-15. TypeSafe claims it is up to 194× faster and 445× cheaper than an LLM on classification-shaped decisions. Nobody has published an independent test on real data yet. The window for being first is weeks, not months.

Jev is not a search engine. It takes a situation plus typed questions and returns a **Choice** or a **Score** with probabilities and a confidence. It does not generate text, parse input, embed, or retrieve. So the fair question is not "can Jev do search" but:

1. **Reranking.** Given a query and 100 retrieved candidates, can Jev Score each one well enough to replace a cross-encoder or an LLM?
2. **Routing.** Given a raw query, can Jev Choice pick the user's intent as accurately as an LLM?

Both are where Jev's speed and cost claims would matter, and both have obvious baselines.

## Hypotheses

Written before running anything, so the post can say which ones survived.

- **H1:** Jev Score reaches at least 90% of Claude Haiku's nDCG@10 as a reranker.
- **H2:** Jev Score's p50 latency for 100 candidates is under 10% of Haiku's.
- **H3:** Jev Choice matches Haiku within 3 points of accuracy on intent routing.
- **H4:** Jev beats the open-source cross-encoder on accuracy. This one is the least certain. A tuned cross-encoder is a strong, free baseline.

## Data

Source: [yc-oss/api](https://github.com/yc-oss/api), an unofficial daily mirror of YC's public directory. Snapshot checked 2026-09-22 (`last_updated 2026-09-22T02:30Z`):

| | |
|---|---|
| Companies | 6,245 across 51 batches |
| Status | 4,322 active, 1,079 inactive, 821 acquired, 23 public |
| Hiring (`isHiring`) | 1,483 |
| Tagged `Open Source` | 173 |
| Missing `long_description` | 416 (fall back to `one_liner` + tags) |

Fields used: `name`, `one_liner`, `long_description`, `industry`, `subindustry`, `tags`, `batch`, `status`, `team_size`, `all_locations`, `regions`, `isHiring`, `website`, `url`.

**Not in the dataset:** founders, GitHub orgs, job listings. That limits which intents v1 can test honestly (below).

Freeze one snapshot into the repo (`data/companies-2026-09-22.json`) so every run is reproducible. Do not re-fetch between runs.

## Intents

| Intent | Example query | v1? | Data it leans on |
|---|---|---|---|
| Competitor | "who else does AI bookkeeping for small agencies" | yes | descriptions, tags |
| Product | "a tool to catch flaky tests in CI" | yes | descriptions, tags |
| Job | "hiring Go engineers, remote-friendly, infra" | yes | `isHiring`, location, team size, descriptions |
| Open source | "open-source YC projects I could contribute to in Rust" | yes, narrow | `Open Source` tag (173 companies) |
| Founder | "founders who left Stripe to build fintech" | **no** | needs founder data the dataset lacks |

Founder search is out of v1. Adding it means scraping YC company pages, which is a separate job with its own ethics and rate-limit questions. Say so in the post rather than faking it.

## Pipeline

Retrieval is held fixed across every arm. Only the reranker changes. Otherwise the comparison measures retrieval, not Jev.

```
query
  → router (Choice: which intent?)          ← arm R1 vs R2
  → hard filters from intent (e.g. isHiring, status=Active, Open Source tag)
  → hybrid retrieval: BM25 + embeddings, top 100
  → reranker (score each candidate)         ← arms A–D
  → top 10
```

Hard filters come from the router's intent, not from parsing the query. Jev cannot parse, so extracting "Go" or "remote" is left to retrieval. That keeps the comparison fair and keeps Jev on the job it is built for.

### Reranker arms

| Arm | Reranker | Notes |
|---|---|---|
| A | None (hybrid retrieval order) | Floor. If a reranker cannot beat this, it is not worth running. |
| B | Cross-encoder, `bge-reranker-v2-m3` (int8 ONNX via transformers.js, CPU) | Free, local, the standard open baseline. 100 pairs in ~2s on a 16-core CPU. |
| C | Claude Haiku 4.5, pointwise 0–10 score | The LLM Jev claims to replace. Also run listwise once as a sanity check. |
| D | Jev (`jev-1.13.0`), one Noul per candidate | "Is this company what the searcher is looking for?" Formulation picked by the dev-split pilot below. |

**How arm C runs:** through Claude Code headless on a Claude subscription, not an API key. This is benchmark-only; the shipped app never calls Claude. Tested 2026-09-22:

```sh
MAX_THINKING_TOKENS=0 claude -p --model claude-haiku-4-5-20251001 \
  --system-prompt "You are a search relevance grader." \
  --tools "" --strict-mcp-config --no-session-persistence \
  --output-format json < prompt.txt
```

- `MAX_THINKING_TOKENS=0` is required. Without it Haiku thought for 277 tokens to answer one digit (4.0s vs 1.0s).
- Score all 100 cards in one prompt, returned as JSON, so it takes 200 calls, not 20,000. Jev gets the same batched treatment.
- Cost comes from the `usage` token counts × Haiku list price ($1/M in, $5/M out), which matches `total_cost_usd`. Count only the benchmark prompt's tokens. Claude Code adds about 700 input tokens of its own per call.
- Latency uses `duration_api_ms`, not `duration_ms`, and the post labels it "via Claude Code". It is close to raw API latency, not identical.
- Do not use `--bare`. It only accepts an API key, not subscription login.

### Router arms

| Arm | Router |
|---|---|
| R1 | Claude Haiku 4.5, one-word answer from the intent list |
| R2 | Jev Choice over the same intent list |

## Labels

### Queries: collected from real people, not written or generated

Nobody writes 200 by hand, and LLM-generated queries would favour the LLM arm. So the queries come from text real people already wrote on Hacker News (free Algolia API, `hn.algolia.com/api/v1`), checked 2026-09-22:

| Intent | Source | Available | Conversion |
|---|---|---|---|
| Competitor | **Launch HN** posts: "Launch HN: X (YC W23) – …" | 1,214 | Take the problem sentences from the post body and remove the company's name. The launching company is a **known correct answer**. |
| Product | **Ask HN** posts asking for a tool or startup ("Is there a startup working on…") | hundreds; filter needed | Use the question as written. |
| Job | **"Who wants to be hired?"** monthly threads | 567 posts in Sept 2026 alone | Keep only `Location`, `Remote` and `Technologies`. Drop names, emails and links. |
| Open source | Thinnest source. Ask HN "open source projects to contribute to" | unknown; check first | If under 50, shrink this intent to what exists rather than pad it. |

Conversion is a script with fixed rules, not an LLM rewrite. Messy human phrasing is the point. The only manual work is a skim of the 200 to drop junk (~30 min). Intent labels come free from the source.

### Grading: an LLM judge, checked against a human sample

Pooling the top 20 from four arms gives roughly 8,000 (query, company) judgments. Too many to grade by hand.

- **Judge:** Claude Opus via Claude Code, grading **0 (irrelevant), 1 (partial), 2 (exact)**, blind to which arm found the company, 20 companies per call.
- **Human check:** hand-grade 10 queries × 20 companies (200 judgments, ~45 min) and report how often the judge agrees.
- **Judge-free check:** for Launch HN queries, report where each arm ranks the launching company. That number needs no grader at all, which makes it the most trustworthy one in the post.
- **Bias to disclose:** a Claude judge may favour a Claude reranker. If Haiku's lead shrinks on the human-graded sample or on the judge-free check, say so.

Everything goes in `labels/` as JSONL, published with the post.

## Metrics

| Metric | Why |
|---|---|
| nDCG@10 | Main ranking quality number |
| Recall@10 against grade-2 companies | Did the exact matches make the page? |
| MRR | Where the first good answer lands |
| p50 / p99 latency, per query of 100 candidates | Jev's headline claim |
| Cost per 1,000 queries | Jev's other headline claim; use published list prices on the run date |
| Router accuracy and confusion matrix | Which intents get mixed up |
| Jev confidence vs correctness (calibration plot) | Jev returns a confidence. Test whether it means anything. |

Report per intent, not just overall. A reranker that wins on competitor queries and loses on job queries is a finding.

Latency is the distribution over all test queries, one run each. Report the region, time of day and concurrency, since latency to a hosted API is mostly network. Jev reports no server timing, so its latency is wall time; Haiku's is `duration_api_ms`. The report labels which is which.

## What would make this worth reading

- **Negative results publish too.** "Jev is 200× faster and 30% worse" is a useful post. So is "the free cross-encoder beats both."
- **The calibration plot is the novel part.** Everyone will compare speed. Few will check whether Jev's confidence can drive a cutoff, like "stop reranking when confidence is above 0.9."
- **Cost at scale, made concrete.** Translate the numbers into "reranking every query for a site with 1M searches a month costs $X with Haiku and $Y with Jev."
- **Everything reproducible.** Frozen data, labels, prompts, and one command to rerun every arm.

## Deliverables

1. `yc-jev-bench` repo: data snapshot, labels, arm implementations, one `bench` command, results as CSV.
2. Write-up with the tables, the calibration plot, per-intent breakdowns and the limitations section.
3. The search UI, live, running whichever arm wins on the cost-quality tradeoff. Link it from the post.
4. An X thread: the headline number first, the chart second, the surprise third.

## Open questions to settle before building

- **Jev access.** Settled: the user has a key. `jev-1.13.0` costs $0.042 per million input tokens, output free. Limits are 1,200 requests/min and 250k tokens/s.
- **How Jev sees a company.** Settled: the same text card every arm and the judge see (`src/lib/cards.ts`). No per-arm tuning.
- **Embedding model for retrieval.** Settled and frozen: `bge-small-en-v1.5`, fused with BM25 by reciprocal rank fusion.
- **Jev per pair vs fan-out.** Jev's docs warn that large state degrades answers, so all 100 cards can't go in one state. Two formulations remain. *Per pair* makes 100 calls, each with `state = {query, card}`. *Fan-out* makes one call with `state = {query}` and 100 questions, each carrying one card. A pilot on a separate **dev split** (5 queries per intent, never reported as results) picks one by nDCG@10, then latency. The test split is untouched until the pick is made. The report shows the pilot table.

## Out of scope for v1

- Founder search (no data).
- Query parsing and extracted filters (Jev cannot parse, so testing it there is unfair).
- Fine-tuning any model.
- Anything beyond YC. Adding other accelerators is a v2 if the post lands.
