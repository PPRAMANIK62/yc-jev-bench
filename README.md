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

## Deploying

Vercel, as a Node serverless function. Three things the search route reads at runtime are invisible to Next's import graph, so `next.config.ts` pins them with `outputFileTracingIncludes` on `/api/search`.

| Must ship | Size | Why tracing misses it |
|---|---|---|
| `data/companies-*.json`, `data/index/**` | 20.1 MB | The tracer does resolve these from the constant paths in `src/lib`, but that is static analysis noticing a string literal, not a guarantee. |
| `models/Xenova/bge-small-en-v1.5/**` | 34.7 MB | Nothing imports the weights. They are opened by name at runtime. |
| `node_modules/onnxruntime-node/**` and `node_modules/onnxruntime-common/**` | 71.8 MB | `@huggingface/transformers` reaches the native ONNX backend through a runtime `require` the tracer cannot follow, and `onnxruntime-node`'s own `dist/binding.js` builds its binary path from a template literal. Leave either out and the route module throws `Cannot find module 'onnxruntime-node'`, which is a 500 on every search. The JavaScript matters as much as the binary: shipping `bin/` alone gives you `.node` files with no `package.json` to resolve through, which fails identically. |

The rest of the function is about 50 MB, for a traced total of 177.0 MB against Vercel's 250 MB uncompressed limit. After a build the file list is `.next/server/app/api/search/route.js.nft.json`, with paths relative to that file. The transformers download cache is excluded, because a machine that has run the benchmark has 690 MB sitting in `node_modules/@huggingface/transformers/.cache`, including a 570 MB reranker the app never loads.

Check the bundle rather than trusting it:

```sh
bun run build
bun run check:bundle
```

`scripts/check-function-bundle.ts` copies exactly the traced files into a sandbox and embeds a query there under `node`. This is the only check that can catch a missing file, because a normal local run resolves everything out of the full `node_modules` on disk and so passes no matter what the trace left out. The first deploy of this app returned 500 for precisely that reason.

A function's filesystem is read-only, so the weights ship in the repo and `src/lib/embed.ts` sets `env.allowRemoteModels = false`. Left on its default, a missing file turns into a 133 MB download that fails with `EACCES` partway through someone's search.

The app embeds queries with the q8 weights while `data/index` holds fp32 document vectors. The fp32 file is 133 MB, past GitHub's 100 MiB limit for one file and too large for the function, so it is gitignored and fetched on demand by the two bench steps that need it. `bun run bench:embed-drift` prints what that mismatch costs.

`maxDuration` on the route is 30 seconds. A cold search measures 3.0 s on a production build here, 1.1 s warm.

If the model cannot load, search still answers. `retrieve()` drops the dense half, returns the BM25 ranking and reports `mode: "keyword_only"`, which the page prints under the results. It is a real loss rather than a free fallback: grade-2 companies reaching the top 100 falls from 910/910 to 709/910, and the Launch HN company is found in 33 of 50 queries instead of 37.

## Running the benchmark

Every script is resumable. It appends to its output, skips work already done, and is a no-op when complete.

| Step | Command | Writes |
|---|---|---|
| Collect queries from Hacker News | `bun run bench:collect` | `data/queries.jsonl` |
| Build the embedding index | `bun run bench:index` | `data/index/` |
| Measure what the app's q8 query weights cost against the fp32 index | `bun run bench:embed-drift` | stdout |
| Freeze 100 candidates per query | `bun run bench:retrieve` | `runs/candidates.jsonl` |
| Pick the Jev and Haiku formulations on the dev split | `bun run bench:pilot` | `data/pilot-<arm>.json` |
| Rerank | `bun run bench:rerank --arm none\|bge\|haiku\|jev [--formulation F] [--split dev\|test] [--limit N]` | `runs/rerank-<arm>[-<formulation>].jsonl` |
| Route | `bun run bench:route --router haiku\|jev [--limit N]` | `runs/route-<router>.jsonl` |
| Grade pooled results with Opus | `bun run bench:judge --split test` | `data/grades.opus.jsonl` |
| Hand-grade the agreement sample | `bun run bench:human` | `data/grades.human.jsonl` |
| Compute every number | `bun run bench:score` | `src/generated/results.json` |
| Score-vs-grade agreement by retrieval position | `bun run bench:position-decay [--split dev\|test]` | stdout |

`bun run bench` runs everything from retrieval to scoring in order. `/report` is prerendered, so rebuild after rescoring.

The Haiku and Opus steps use the Claude subscription behind your `claude` CLI. Haiku's pilot picked ten prompts of 10 cards per search, so the full test split is about 2,000 Haiku calls (8 in flight) plus a few hundred Opus calls.
