# yc-jev-bench design brief (binding)

Subject: an independent benchmark of TypeSafe's Jev model as a search reranker, on all 6,245 YC companies.
Audience: engineers and founders on X/HN who click through from a thread. They want the number, then want to check it.
The site's single job: make the benchmark result legible and checkable. The live search is the proof you can touch.

## Thesis and signature

The signature is **the rerank itself, made visible**: things physically move from retrieval order to reranked order.

- Search page: results appear first in retrieval order, then glide (FLIP/layout animation) into Jev's order. Each row carries a mono rank-delta mark, `↑14` in Jev ultramarine for climbs, `↓3` muted for falls, `new · was #47` for rows that entered the top 10 from deep in the candidates.
- Report: the query explorer is a **bump chart**. Four columns (None → BGE → Haiku → Jev), one thread per company connecting its rank in each column. Thread weight/opacity encodes the judge's grade (2 = ink, heavy; 1 = mid; 0 = faint). Hover or focus a company and its thread lights up across all columns; the others dim.

Spend boldness there only. Everything else is quiet and precise.

## Tokens

Colour is information: every arm has one fixed colour used in every chart, legend, table swatch and thread. Jev is the only saturated colour on the page.

| Token | Light | Dark | Use |
|---|---|---|---|
| paper | #E8EBE4 | #101211 | page background (mineral grey-green, not cream) |
| surface | #F3F5F0 | #171A18 | cards, table rows on hover, input |
| ink | #15171A | #E6E9E2 | text, grade-2 threads |
| muted | #6B7069 | #8C928A | secondary text, captions |
| rule | #C9CEC4 | #2A2E2B | hairlines, gridlines |
| arm-none | #8B9088 | #7A8078 | graphite |
| arm-bge | #1F7A6D | #3FB8A4 | teal |
| arm-haiku | #B7792B | #D9A04F | ochre |
| arm-jev | #2F2BFF | #7C79FF | ultramarine: Jev, focus rings, primary action |

Define as CSS variables on `:root`, dark under `@media (prefers-color-scheme: dark)` and `.dark`, and map shadcn's variables (background, foreground, primary, ring, border, muted…) onto them in `src/app/globals.css`. Radius 10px on surfaces, 999px on chips. No gradients, no drop shadows beyond a 1px rule.

## Type (next/font/google)

- **Instrument Sans** (variable, use the `wdth` axis): headings and UI. Headings at wdth ~78, weight 600, tracking -0.02em. The narrow width is the type personality; do not also make it huge everywhere.
- **Source Serif 4**: report prose only (the report reads like a short paper). 17–18px, line-height 1.6, measure ≤ 68ch.
- **Martian Mono**: every number, rank, metric, label, eyebrow, the "under the hood" line, table figures. Tabular numerals. Small sizes (11–13px) with +0.02em tracking for labels; the report hero number is the one place mono goes huge.

## Layout

Search (`/`):
```
 yc × jev                                   Read the benchmark →
 ─────────────────────────────────────────────────────────────
 Search every YC company in plain English
 [ who else does AI bookkeeping for small agencies        ⏎ ]
 Competitors · Products · Jobs · Open source   (chips appear only when Jev is unsure, or after results to override)

  1  ↑14  Pilot            W17  Bookkeeping for startups…   Active · 250 · hiring
  2  —    …
 ─────────────────────────────────────────────────────────────
 Jev: competitor (0.93) · reranked 100 companies in 38 ms · $0.00004 · how this was tested →
```
Empty state before a search: three or four example queries as plain text buttons that run the search. Status badges for Inactive/Acquired companies say so plainly ("inactive since…" is not in the data; just "Inactive"). Founder queries: Jev cannot route them (no founder intent); do not pretend. A footer note says the data is an unofficial mirror of YC's public directory (yc-oss/api), snapshot 2026-09-22, not affiliated with YC or TypeSafe.

Report (`/report`), single long column (max ~1100px, prose column narrower), in this order:
1. Hero: one sentence verdict generated from results.json, with the single key number set huge in Martian Mono. Under it a mono meta line: n queries · graded pairs · snapshot date · judge. No stat-tile row.
2. The setup: the pipeline as a real sequence (numbers are OK here because it is one): query → route → filter → retrieve 100 → rerank → top 10. Small inline diagram.
3. Ranking quality: table, arms as rows, nDCG@10 / Recall@10 / MRR with 95% CI whiskers drawn inline.
4. Speed and cost: scatter of nDCG@10 (y) against p50 latency (x, log scale), one dot per arm; plus a table with p50, p99, cost per 1k, and "cost at 1M searches/month".
5. By intent: four small multiples, same scale.
6. The judge-free check: Launch HN known-item rank per arm (distribution strip).
7. Routing: accuracy for Haiku vs Jev and the two confusion matrices side by side.
8. Does Jev's confidence mean anything? Reliability diagram (confidence bins vs accuracy, diagonal reference).
9. Hypotheses H1–H4 with verdicts (supported / rejected / pending).
10. Query explorer: the bump chart, with a query picker (search the 200 queries by text, filter by intent).
11. How much to trust this: judge agreement, limitations, bias disclosure.
12. Reproduce: the exact commands.

Every section must render gracefully when its data is missing: an arm or router that has not run yet shows as "not run yet" in its colour at low opacity, never as zero. If `results.synthetic` is true, a fixed banner says "Synthetic data for layout only. These are not results." in plain words.

## Motion

Library: `motion` (motion/react). One orchestrated moment per page:
- Search: the rerank glide (layout animation, spring ~ stiffness 380 / damping 34), rank-delta marks fade in after rows settle, stagger 18ms.
- Report: charts draw in once when scrolled into view (bars grow from 0, threads draw along their path via pathLength), nothing loops.
Hover: 120ms colour transitions only. `prefers-reduced-motion`: no movement; rows swap instantly and the delta marks still show.

## Copy rules

Plain, specific, sentence case. Name things by what readers recognize ("No reranking", not "Arm A"). Buttons say what happens ("Search", "Show all 200 queries"). Errors say what failed and what to do ("Jev didn't answer in time. Showing results without reranking."). No hype words. Never say "powered by AI".

## Quality floor

Responsive to 360px (bump chart scrolls horizontally inside its own container; page never scrolls sideways), visible keyboard focus in ultramarine, all charts have a text alternative (a visually hidden table or aria-label summary), colour is never the only encoding (arm labels sit next to marks).
