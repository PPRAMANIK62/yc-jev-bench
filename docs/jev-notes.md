# Jev / TypeSafe AI — engineering reference (JS/TS SDK v0.6.0)

Sources: docs.typesafe.ai mirror (fetched 2026-09-22) + ground truth from
`@typesafe-ai/sdk@0.6.0`'s `dist/index.d.mts`. Where docs and types disagree, types win (noted inline).

## 1. Install, client, env, models, timeouts/retries

```bash
npm install @typesafe-ai/sdk   # or: bun add @typesafe-ai/sdk   (Node 20+, ESM+CJS+.d.ts)
```
```ts
import { TypeSafeClient, choice, score, noul } from "@typesafe-ai/sdk";
const client = new TypeSafeClient(); // config optional; explicit > env > default
```
`TypeSafeClientConfig` fields (explicit > env var > default):

| Field | Env fallback | Default |
|---|---|---|
| `apiKey` | `TYPESAFE_API_KEY` | required, throws `TypeSafeError` if missing |
| `baseURL` | `TYPESAFE_BASE_URL` | `https://api.typesafe.ai` |
| `defaultModel` | `TYPESAFE_DEFAULT_MODEL` | `jev-latest` |
| `logLevel` | `TYPESAFE_LOG_LEVEL` | `warn` |
| `timeout` | — | `10000` ms **per attempt**, no total retry budget |
| `retry` | — | see below |
| `dangerouslyAllowBrowser` | — | `false` — keep false; call from a Next.js server/route handler |
| `defaultHeaders`, `fetch`, `logger` | — | `{}`, global `fetch`, prefixed console |

`RetryPolicy` defaults (exact, from `dist/index.d.mts`):
`maxRetries=2, backoffInitialMs=500, backoffMaxMs=5000, backoffJitter=0.25,
httpStatuses={408,429,500-599}, respectRetryAfter=true, maxRetryAfterMs=60000,
apiConnectionError=true, apiTimeoutError=true`. Override per-call:
`systemOne(request, { timeout, retry, headers, signal })`.

**Models** — one endpoint, `POST /v1/systemone`, selected by the `model` field:

| Name | Resolves to |
|---|---|
| `jev-1.13.0` | current pinned model |
| `jev-latest` (SDK default) | `jev-1.13.0` |
| `jev-preview` | `jev-1.13.0` (no preview build live right now) |

Response's `model` field reports the resolved versioned id — pin `jev-1.13.0` if you
tune confidence thresholds, since aliases move without notice. List models:
`client.models.list(): APIPromise<ModelCard[]>` (`{name, description, release_date}`),
backed by `GET /v1/models`.

## 2. Request shape, question builders, limits

```ts
interface SystemOneRequest<Q> { state: EntryType; questions: Q; model?: string; }
type EntryType = string | { [k: string]: JsonValue } | JsonValue[] | null;
```
Exact builder signatures (`src/questions.d.ts`):
```ts
const noul:   (instructions?: EntryType, criteria?: { true?: EntryType; false?: EntryType } | null) => NoulQuestion;
const score:  <const T extends ScoreCriteria>(instructions: EntryType, criteria: T) => ScoreQuestion<T>;
const choice: <const T extends ChoiceCriteria>(instructions: EntryType, criteria: T) => ChoiceQuestion<T>;
type ChoiceCriteria = { [label: string]: EntryType };                     // Description = EntryType
type ScoreCriteria  = readonly [EntryType, EntryType, ...EntryType[]];    // min 2 entries
```
`T` is inferred from the literal criteria (`const T`), so `answers.category.choice` is
typed `keyof T & string` and `answers.x.score`'s `legend` is typed per-rubric.

```ts
const { answers } = await client.systemOne({
  state: { document: "I was charged twice. Please fix this ASAP." },
  questions: {
    category: choice("What is this ticket about?", { billing: null, technical: null, other: null }),
    severity: score("How severe is the reported issue?", [
      "Cosmetic; no impact", "Broken, workaround exists", "Blocking; no workaround",
    ]),
    is_urgent: noul("Does this message convey urgency?"),
  },
});
```
Plain-object form also works: `{ type: "choice", instructions, criteria }`.

**Fan-out**: put every question your code might need in one call — all questions
evaluate against the same `state` in parallel, independently; one answer is never
context for another. Docs claim batching 13 questions into one call vs. 13 calls is
~11.5x cheaper, ~9.6x faster (from an undownloaded cookbook — directional, not verified here).

**Limits**:
- Choice: up to **255 options**.
- Score: **2–10 levels** (SDK type only enforces ≥2; 10-cap is server-side, not in `.d.ts`).
- Questions per call: **not documented as a hard cap** — bounded by the token budget.
- Context (jev-1.13): **64k tokens/request** (`state` + all `questions` combined);
  **32k tokens** for `state` + the single longest question.
- `instructions`, Choice option descriptions, Score level descriptions, Noul
  `true`/`false` all accept `string | object | array | null`; use structured objects
  (e.g. `{what, not_for, examples}`) to sharpen ambiguous boundaries — field names are
  not reserved by the API.

## 3. Response shape

```ts
interface SystemOneResult<Q> { model: string; answers: {[K in keyof Q]: ResultFor<Q[K]>}; usage: Usage; }
interface NoulResponse   { type: "noul";   noul: number; }                          // 0..1, NO confidence field
interface ChoiceResponse { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number>; }
interface ScoreResponse  { type: "score";  score: number;  confidence: number; legend: Record<string, EntryType>; probabilities: Record<string, number>; }
interface Usage { input_tokens: number; output_tokens: number; }  // output free, see §5
```
No latency/timing field is documented or typed anywhere. Request id is **not** on
`SystemOneResult` — only via the raw HTTP layer: header `x-typesafe-request-id`, on
`.requestId` of `APIError` and of `WithResponse<T>`.

**Raw response / headers** — `systemOne()` returns `APIPromise<T>` (extends `Promise<T>`):
```ts
const p = client.systemOne({ state, questions });
const answers = await p;                                 // normal parsed result
const { data, response, requestId } = await p.withResponse();
const raw: Response = await p.asResponse();               // unparsed; caller owns body
```
`.map(fn)` transforms the parsed result sharing one body parse. Non-2xx rejects with
`APIError` even through `asResponse()`.

## 4. Raw HTTP API

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```
```json
{"state": "...", "model": "jev-latest",
 "questions": {"is_urgent": {"type": "noul", "instructions": "Does this convey urgency?"}}}
```
Response: `{"model":"jev-1.13.0","answers":{"is_urgent":{"type":"noul","noul":0.95}},"usage":{"input_tokens":296,"output_tokens":20}}`.
Models: `GET /v1/models` same auth header → `{ models: [{name, description, release_date}] }`.

## 5. Pricing and rate limits (jev-1.13)

- **$42/Btok or $0.042/Mtok, input tokens only — output tokens are free.**
- **Rate limits: 250,000 tokens/sec, 1,200 requests/min.** Docs warn these are
  "adjusting dynamically... can change without notice." Exceeding either → `429`.
- Higher limits: enterprise/custom plans only (sales@typesafe.ai).

## 6. Re-ranking cookbook (`rerank_typesafe`) — exact method

BM25 shortlist (`TOP_K=30`) per query; re-ranking only reorders that shortlist.

**State** — one call per (query, candidate) pair:
```python
state = {"query_excerpt": query, "candidate_passage": candidate}
```
**Question** — a single **Noul** (not a Score):
```python
is_cited_source = Noul(
    instructions="...Could the candidate passage be from that cited precedent — does it "
                 "establish the specific legal proposition the query excerpt invokes...?",
    criteria=NoulCriteria(
        true="The candidate passage states or establishes the specific rule/holding the query relies on.",
        false="The candidate passage is merely on a similar topic or doctrine.",
    ),
)
noul_score = response.answers["is_cited_source"].noul   # e.g. 0.87
```
**Ranking score**: the cookbook does **not** compute an expected value over ordered
levels — it uses the raw `noul` (0..1) directly and sorts descending:
```python
nouls = {c: ask_typesafe(query, c) for c in shortlist}
reranked = sorted(shortlist, key=lambda c: nouls[c], reverse=True)
```
(A `Score` with ordered relevance levels would instead give you `answer.score` already
computed as `Σ level_i × P(level_i)` — see §2/primitives_score.md — but that's not
what this cookbook does; jaggedness item 2 below warns against over-trusting a Score's
exact interpolated magnitude.)

**Fan-out note**: this cookbook deliberately asks one bare question per pair "for
clarity," and explicitly says a real application would ask **several questions about
the same pair in one call** — for a ~100-candidate rerank, batch relevance +
disambiguating Nouls into one `questions` map per (query, candidate) call.

**Results** (CLERC, 3,565 passages, 40 queries, model `jev-1.12` — older than current `jev-1.13.0`):

| Metric | BM25 only | + TypeSafe rerank |
|---|---|---|
| Top 1 | 5% | **18%** |
| Top 5 | 15% | **35%** |
| Top 10 | 38% | **62%** |

Cost: 1,200 calls, 1,536,002 input + 25,200 output tokens, **$0.0645** total.

## 7. Confidence semantics

- `confidence` (0–1) exists only on `ChoiceResponse`/`ScoreResponse`; **Noul has no
  confidence** — `noul` itself is already the calibrated yes-probability.
- Derived from the shape of `probabilities`: concentrated on one option/level →
  confidence ≈1; spread out → ≈0. Related to, but not simply equal to, the raw top
  probability.
- **Exact formula: not documented.** Docs explicitly decline to specify it and say a
  cookbook may follow later. The docs' interactive widget uses an illustrative
  3-option approximation, `(3 × largest_probability − 1) / 2` (generalized in its own
  code as `((n × peak) − 1) / (n − 1)`, clamped `[0,1]`) — stated as a demo
  approximation only, not asserted as the production formula.
- Full `probabilities` is always returned, so you can compute your own confidence
  statistic if needed — docs invite this.

**Confidence-gated routing pattern** — three bands, thresholds set per-action by
stakes, not globally:
```ts
const action = answers.intent; // ChoiceResponse
if (action.confidence < 0.6) routeToHuman();
else if (action.choice === "check_balance") showBalance();          // low stakes: 0.6 floor enough
else if (action.choice === "approve_transfer") {
  if (action.confidence > 0.85) approveTransfer();                  // high stakes, act only if very sure
  else askUserToConfirm();
}
```
High confidence → act automatically. Medium → proceed with caution (confirm/flag/gather
more info). Low → don't act, route out. No universal thresholds; worked examples use
0.5–0.6 as an "unsure" floor and 0.85–0.9 as a "safe to auto-act on a risky action"
ceiling; docs say explicitly to start conservative and tune on your own data.

**4-intent routing pattern** (documented shape): one `Choice` over your intents in the
same call as a `Score` (e.g. complexity), gate on `intent.confidence` before dispatch:
```ts
const { answers } = await client.systemOne({
  state: message,
  questions: {
    intent: choice("The primary intent of this message", {
      order_status: "...", product_question: "...", return_exchange: "...", complaint: "...",
    }),
    complexity: score("How complex is this request to resolve", [
      "Simple lookup or standard procedure", "Requires judgment or multi-step process",
      "Unusual situation, edge case, or escalation needed",
    ]),
  },
});
if (answers.intent.confidence < 0.5) return routeToHuman();
switch (answers.intent.choice) {
  case "order_status": return handleOrderStatus();
  case "product_question": return handleWithLlm(PRODUCT_SPECIALIST);
  case "return_exchange": return handleWithLlm(RETURNS_SPECIALIST);
  case "complaint": {
    if (answers.complexity.score > 1 || answers.complexity.confidence < 0.5) return routeToHuman();
    return handleWithLlm(COMPLAINT_RESOLUTION);
  }
}
```

## 8. Jev 1.13 jaggedness (reviewed 2026-09-17) — relevant to reranking/classification

1. **Literal reading** — answers the exact words, no implied intent. Spell out exact
   conditions in `instructions`; put boundary cases in `criteria`; split ambiguity into
   two literal questions, combine in code.
2. **Math/numbers** — not a calculator; unreliable counting (chars, occurrences, list
   items — count in code, or one Noul per item summed in code). Numeric representations
   underperform semantic ones (hex colors < color names). **Don't reconstruct an exact
   magnitude by interpolating a Score between levels** — fine to threshold the
   expectation, not fine as a precise number.
3. **Date/time** — reads dates as text not ordered quantities; ordering/duration/window
   checks unreliable. Extract parts as bounded `Choice`s, do arithmetic in code.
4. **Indirection** — multi-hop / "property of a property" questions lose accuracy.
   Write directly; name state fields explicitly.
5. **Large state, irrelevant detail** — accuracy falls as `state` grows with unrelated
   content ("context rot"). **Directly relevant to reranking 100 candidates**: score
   pairs individually (as the cookbook does), never stuff all candidates into one
   `state`; filter in code first, or use a Noul relevance pre-filter cascade
   (`classifying_rag_passages` pattern: `is_relevant`, `contains_answer_evidence`,
   `contradicts_query_premise`, `contains_prompt_injection`, evaluated first-match-wins
   with independent thresholds).
6. **Adversarial content** — `state` isn't treated as hostile by default; injected
   instructions/persuasive framing inside candidate text can move the answer. Write
   precise criteria, test adversarial inputs (matters if candidate text is user-supplied).
7. **Contradictory instructions/criteria** — e.g. Noul `true` describing a "no" outcome
   confuses it. Keep `criteria` same-polarity with `instructions`.
8. **No structural invariants** — a Noul and an equivalent yes/no Choice on the same
   judgment give incomparable numbers (docs' example: Noul `noul=0.22` vs. Choice
   `probabilities.yes=0.01, confidence=0.97`). Two negated Nouls need not sum to 1
   (`0.72` + `0.47` = `1.19`). Don't carry a threshold tuned on one question phrasing
   to another; tune Noul filters and Choice routers independently.
9. **Generation** — not built to generate text; chaining Choices to force generation is
   slow/poor. Use bounded `Choice` for extraction instead.

General: don't ask Jev what code can compute exactly; don't hide multiple judgments in
one question; avoid multi-hop "System Two" tasks; keep `state` to only what the
question needs (context rot). Context window: 64k/request total, 32k for
state+longest-question (§1/§2).

## 9. Error classes and retryability

```
TypeSafeError extends Error                     — SDK base
├─ APIError  { status, headers: Headers, body: unknown, requestId?: string }
│   ├─ BadRequestError          (400)            NOT retried
│   ├─ AuthenticationError      (401)             NOT retried
│   ├─ PermissionDeniedError    (403)             NOT retried
│   ├─ NotFoundError            (404)             NOT retried
│   ├─ UnprocessableEntityError (422)             NOT retried
│   ├─ RateLimitError  (429) { retryAfterMs?: number }        RETRIED
│   └─ InternalServerError (5xx, incl. 529 Overloaded)        RETRIED
├─ APIConnectionError                            DNS/TLS/dropped connection — RETRIED
│   └─ APITimeoutError { timeoutMs: number }      response didn't arrive in time — RETRIED
└─ APIUserAbortError                             caller's AbortSignal fired — NEVER retried
```
`APIError.fromResponse(status, body, headers)` picks the subclass. Retryability is
governed by `RetryPolicy` (§1): `httpStatuses` default `{408,429,500-599}` covers
`RateLimitError`/`InternalServerError` (and bare 408, no named subclass);
`apiConnectionError`/`apiTimeoutError` default `true`. `400/401/403/404/422` are
non-retryable client errors — fix the request. Retries use exponential backoff
(`500ms` doubling to `5000ms` cap, `0.25` jitter) honoring `Retry-After`/
`retry-after-ms` up to `60000ms`. `systemOne()` also throws a synchronous
`TypeSafeError` (not retried, not an HTTP failure) if `questions` is empty or a
Score's `criteria` has <2 entries.

HTTP status meanings (`/api` docs): `401` missing/invalid key · `422` validation
failed (body names the field) · `429` rate limit, back off · `529` "Overloaded," back
off and retry.
