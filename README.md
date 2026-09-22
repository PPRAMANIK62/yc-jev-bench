# yc-jev-bench

Can Jev replace an LLM reranker? An independent benchmark of TypeSafe's Jev on natural-language search over all 6,245 YC companies, plus a live search demo that runs on it.

- `/` is the live search. Your query is routed by Jev, retrieved with BM25 + embeddings, then reranked by Jev.
- `/report` is the benchmark write-up, rendered from `src/generated/results.json`.

The spec is `EXPERIMENT.md`. Design rules are in `docs/design.md`. Jev API notes are in `docs/jev-notes.md`.

## Setup

```sh
bun install
cp .env.example .env.local   # set TYPESAFE_API_KEY
bun run dev
```

The only key the app needs is `TYPESAFE_API_KEY`. The Haiku arm and the Opus judge run through your local `claude` CLI (Claude Code on a subscription). They are used by the benchmark only and never by the app.

## Running the benchmark

Every script is resumable. It appends to its output, skips work already done, and is a no-op when complete.

| Step | Command | Writes |
|---|---|---|
| Collect queries from Hacker News | `bun run bench:collect` | `data/queries.jsonl` |
| Build the embedding index | `bun run bench:index` | `data/index/` |
| Freeze 100 candidates per query | `bun run bench:retrieve` | `runs/candidates.jsonl` |
| Pick the Jev and Haiku formulations on the dev split | `bun run bench:pilot` | `data/pilot-<arm>.json` |
| Rerank | `bun run bench:rerank --arm none\|bge\|haiku\|jev [--formulation F] [--split dev\|test] [--limit N]` | `runs/rerank-<arm>[-<formulation>].jsonl` |
| Route | `bun run bench:route --router haiku\|jev [--limit N]` | `runs/route-<router>.jsonl` |
| Grade pooled results with Opus | `bun run bench:judge --split test` | `data/grades.opus.jsonl` |
| Hand-grade the agreement sample | `bun run bench:human` | `data/grades.human.jsonl` |
| Compute every number | `bun run bench:score` | `src/generated/results.json` |
| Score-vs-grade agreement by retrieval position | `bun run bench:position-decay [--split dev\|test]` | stdout |

`bun run bench` runs everything from retrieval to scoring in order. `/report` is prerendered, so rebuild after rescoring.

The Haiku and Opus steps use the Claude subscription behind your `claude` CLI. For the full test split that's about 200 Haiku calls and a few hundred Opus calls.
