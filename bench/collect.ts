// Queries come from text real people wrote on Hacker News, converted by fixed rules (EXPERIMENT.md "Labels").
// Fetches once into data/queries.candidates.jsonl; pass --refresh to refetch. Selection is deterministic.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadCompanies } from "../src/lib/companies";
import { INTENTS, type BenchQuery, type CompanyId, type Intent, type QueryId, type QuerySource } from "../src/lib/domain";
import { QUERIES_FILE, SEED, readJsonl, seededShuffle } from "./lib";

const CANDIDATES = "data/queries.candidates.jsonl";
const API = "https://hn.algolia.com/api/v1";
const DEV_PER_INTENT = 5;
const TEST_PER_INTENT = 50;
const WWTBH_THREADS = 6;
const OPEN_SOURCE_MINIMUM = 20;

type Candidate = Omit<BenchQuery, "split">;

interface Hit {
  objectID: string;
  title: string | null;
  story_text: string | null;
  created_at_i: number;
}

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as T;
    if (attempt >= 3) throw new Error(`${res.status} from ${url}`);
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

// Algolia caps any one query at 1,000 hits, so walk backwards in time.
async function searchAll(params: Record<string, string>, max = 5000): Promise<Hit[]> {
  const out: Hit[] = [];
  let before = Math.floor(Date.now() / 1000) + 1;
  while (out.length < max) {
    const q = new URLSearchParams({ ...params, hitsPerPage: "1000", numericFilters: `created_at_i<${before}` });
    const { hits } = await getJson<{ hits: Hit[] }>(`${API}/search_by_date?${q}`);
    if (!hits.length) break;
    out.push(...hits);
    before = hits[hits.length - 1].created_at_i;
    if (hits.length < 1000) break;
  }
  return [...new Map(out.map((h) => [h.objectID, h])).values()];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function htmlToText(html: string): string {
  return html
    .replace(/<p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hnUrl = (id: string) => `https://news.ycombinator.com/item?id=${id}`;

// ---------------------------------------------------------------- Launch HN → competitor

const LAUNCH_TITLE = /Launch HN: (.+?) \(YC ([WSFX]\d{2})\)/;
const INTRO_SENTENCE = /^(hi|hey|hello|howdy)\b|\b(we['’]re|we are|i['’]m|i am|my name|co-?founders?|founders? of|here from|this is)\b|https?:\/\/|\bHN\b/i;
const OFF_TOPIC_SENTENCE = /\b(YC|Y Combinator|launch\w*|demo|sign ?up|try (it|us|our)|free trial|pricing|video|feedback|thanks|thank you|excited|somebody said|stealth|download|waitlist|comments?)\b|[:(]$/i;
const SENTENCE_BREAK = /(?<!\b(?:e\.g|i\.e|vs|etc|Inc|approx))(?<=[.!?])\s+(?=[A-Z0-9"“(])/;
const NAME_SUFFIX = /\s*(,?\s*inc\.?|\.ai|\.com|\.io|\.so|\.dev|\.co|\s+ai|\s+labs?|\s+hq|\s+technologies|\s+health)$/i;

function launchHn(hits: Hit[]): { rows: Candidate[]; unmatched: number; tooShort: number } {
  const byBatch = new Map<string, { key: string; id: CompanyId; name: string }[]>();
  for (const c of loadCompanies()) {
    const list = byBatch.get(c.batchShort) ?? [];
    list.push({ key: nameKey(c.name), id: c.id, name: c.name });
    byBatch.set(c.batchShort, list);
  }
  const rows: Candidate[] = [];
  let unmatched = 0;
  let tooShort = 0;
  for (const h of hits) {
    const m = LAUNCH_TITLE.exec(h.title ?? "");
    if (!m) continue;
    const [, titleName, batch] = m;
    const key = nameKey(titleName);
    const pool = byBatch.get(batch) ?? [];
    const company =
      pool.find((c) => c.key === key) ??
      pool.find((c) => key.length >= 4 && c.key.length >= 4 && (c.key.startsWith(key) || key.startsWith(c.key)));
    if (!company) {
      unmatched++;
      continue;
    }
    const names = [...new Set([titleName, company.name, titleName.replace(NAME_SUFFIX, ""), company.name.replace(NAME_SUFFIX, "")])]
      .filter((n) => n.length >= 3)
      .sort((a, b) => b.length - a.length);
    const nameRe = new RegExp(`\\b(${names.map(escapeRe).join("|")})(['’]s)?\\b`, "gi");
    const sentences = htmlToText(h.story_text ?? "")
      .split(/\n+/)
      .flatMap((para) => squash(para).split(SENTENCE_BREAK))
      .filter((s) => s.length >= 20 && !INTRO_SENTENCE.test(s) && !OFF_TOPIC_SENTENCE.test(s));
    let text = "";
    for (const s of sentences.slice(0, 2)) {
      if (text && text.length + s.length > 400) break;
      text = squash(`${text} ${s}`);
    }
    text = text.replace(nameRe, (_, _name, poss) => (poss ? "a company's" : "a company")).replace(/^a company/, "A company");
    if (text.length < 60) {
      tooShort++;
      continue;
    }
    rows.push({
      id: `lhn-${h.objectID}` as QueryId,
      intent: "competitor",
      text,
      source: { kind: "launch_hn", hnId: h.objectID, url: hnUrl(h.objectID) },
      knownAnswer: company.id,
    });
  }
  return { rows, unmatched, tooShort };
}

// ---------------------------------------------------------------- Ask HN → product, open_source

const PRODUCT_TITLE = /\b(is there an? (tool|app|service|startup|product|saas|company|website|platform)|looking for an? (tool|service|app|saas|product|platform))\b/i;
// "alternative to X" only when X looks like a named product (capitalized), which drops "alternatives to work/life balance"
const ALTERNATIVE_TO_PRODUCT = /\b[Aa]lternatives? (to|for) [A-Z0-9]/;
const OPEN_SOURCE_TITLE = /\b(open[- ]?source|self[- ]?hosted|foss)\b/i;
const OPEN_SOURCE_ASK = /\b(contribute to|to contribute|alternatives?|looking for|is there|recommend\w*|suggest\w*|any open[- ]?source \w+|(tools?|apps?|software|library|libraries|platforms?|frameworks?|projects?) (for|to|that|like))\b/i;
const OPEN_SOURCE_META = /\b(why|how|challenges?|best practices|famous|commits?|licen[cs]\w*|monetiz\w*|business|funding|money|paid|pay|sustain\w*|donat\w*|maintainers?|burnout|companies|hired|real name)\b|%|^(do|does|did|shall|should|would|will|what makes)\b/i;
const META_TITLE = /\b(y ?combinator|yc|startup ideas?|careers?|jobs?|hiring|hire|salary|salaries|cofounders?|co-founders?|founders?|interview\w*|resumes?|visa|degree|bootcamp|laptop|macbook|phone|keyboard|book|books|course|courses|learn|learning|guide|advice|how do (i|you)|should i|who is|who wants|freelanc\w*)\b/i;

function askTitle(title: string): string {
  return squash(htmlToText(title).replace(/^(Ask|Tell) HN:\s*/i, ""));
}

function askHn(hits: Hit[]): Candidate[] {
  const rows: Candidate[] = [];
  for (const h of hits) {
    const raw = h.title ?? "";
    if (!/^Ask HN:/i.test(raw)) continue;
    const title = askTitle(raw);
    if (META_TITLE.test(title) || title.length < 15) continue;
    const source: QuerySource = { kind: "ask_hn", hnId: h.objectID, url: hnUrl(h.objectID) };
    let intent: Intent | null = null;
    if (OPEN_SOURCE_TITLE.test(title)) {
      if (OPEN_SOURCE_ASK.test(title) && !OPEN_SOURCE_META.test(title)) intent = "open_source";
    } else if (PRODUCT_TITLE.test(title) || ALTERNATIVE_TO_PRODUCT.test(title)) intent = "product";
    if (intent) rows.push({ id: `ahn-${h.objectID}` as QueryId, intent, text: title, source, knownAnswer: null });
  }
  return rows;
}

// ---------------------------------------------------------------- Who wants to be hired → job

interface Item {
  id: number;
  text: string | null;
  children: Item[];
}

function field(lines: string[], name: RegExp): string | null {
  const line = lines.find((l) => name.test(l));
  return line ? squash(line.replace(name, "")) : null;
}

// Reads only Location, Remote and Technologies. Nothing else from the post is kept.
export function wwtbhQuery(html: string): string | null {
  const lines = htmlToText(html).split("\n").map((l) => l.trim());
  const tech = field(lines, /^\s*(technologies|tech stack|skills)\s*:\s*/i);
  if (!tech) return null;
  const top = tech
    .replace(/\([^)]*\)/g, "")
    .split(/[,;|•·]| and /)
    .map((t) => squash(t.replace(/^[a-z ]+:\s*/i, "").replace(/[.]+$/, "")))
    .filter((t) => t.length >= 1 && t.length <= 25 && !/[@:]|https?|www\.|\.com\b/i.test(t))
    .slice(0, 4);
  if (top.length < 2) return null;
  const remote = field(lines, /^\s*remote\s*:\s*/i);
  const location = field(lines, /^\s*location\s*:\s*/i);
  const city = location?.split(/[,(/;]/)[0].trim() ?? "";
  const remoteFriendly = remote !== null && /^(yes|y\b|ok|sure|remote|prefer|only|either|both|open|hybrid)/i.test(remote);
  const cityOk = city.length >= 2 && city.length <= 30 && !/\b(remote|anywhere|worldwide|global|n\/?a|none|earth|various|flexible)\b/i.test(city);
  return `startups hiring engineers who know ${top.join(", ")}${remoteFriendly ? ", remote-friendly" : ""}${cityOk ? `, in ${city}` : ""}`;
}

async function wwtbh(): Promise<Candidate[]> {
  const threads = (await searchAll({ tags: "story,author_whoishiring" }, 1000))
    .filter((h) => /who wants to be hired/i.test(h.title ?? ""))
    .sort((a, b) => b.created_at_i - a.created_at_i)
    .slice(0, WWTBH_THREADS);
  const rows: Candidate[] = [];
  for (const t of threads) {
    const item = await getJson<Item>(`${API}/items/${t.objectID}`);
    const thread = (t.title ?? "").replace(/^Ask HN:\s*/i, "");
    for (const c of item.children) {
      const text = c.text ? wwtbhQuery(c.text) : null;
      if (!text) continue;
      const hnId = String(c.id);
      rows.push({ id: `wwtbh-${hnId}` as QueryId, intent: "job", text, source: { kind: "wwtbh", hnId, url: hnUrl(hnId), thread }, knownAnswer: null });
    }
  }
  return rows;
}

// ---------------------------------------------------------------- main

async function fetchCandidates(): Promise<Candidate[]> {
  const launches = await searchAll({ query: '"Launch HN"', tags: "story" });
  const lhn = launchHn(launches);
  console.log(`launch hn: ${launches.length} stories, ${lhn.rows.length} usable, ${lhn.unmatched} unmatched to a company, ${lhn.tooShort} too short`);

  const askQueries = [
    "is there a tool", "is there an app", "is there a service", "is there a startup", "is there a product", "is there a saas",
    "looking for a tool", "looking for a service", "alternative to", "alternatives to",
    "open source contribute", "open source projects", "open source alternative", "self-hosted alternative",
  ];
  const askHits: Hit[] = [];
  for (const q of askQueries) askHits.push(...(await searchAll({ query: q, tags: "ask_hn" }, 3000)));
  const ask = askHn([...new Map(askHits.map((h) => [h.objectID, h])).values()]);
  console.log(`ask hn: ${askHits.length} hits, ${ask.length} usable`);

  const jobs = await wwtbh();
  console.log(`who wants to be hired: ${jobs.length} usable`);
  return [...lhn.rows, ...ask, ...jobs];
}

function select(candidates: Candidate[]): BenchQuery[] {
  const out: BenchQuery[] = [];
  for (const intent of INTENTS) {
    const seen = new Set<string>();
    const pool = candidates
      .filter((c) => c.intent === intent)
      .sort((a, b) => Number(a.source.hnId) - Number(b.source.hnId))
      .filter((c) => {
        const key = c.text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const shuffled = seededShuffle(pool, SEED);
    shuffled.slice(0, DEV_PER_INTENT).forEach((c) => out.push({ ...c, split: "dev" }));
    shuffled.slice(DEV_PER_INTENT, DEV_PER_INTENT + TEST_PER_INTENT).forEach((c) => out.push({ ...c, split: "test" }));
    if (intent === "open_source" && pool.length < OPEN_SOURCE_MINIMUM) console.warn(`open_source: only ${pool.length} usable, short of ${OPEN_SOURCE_MINIMUM}`);
  }
  return out;
}

const refresh = process.argv.includes("--refresh");
let candidates = readJsonl<Candidate>(CANDIDATES);
if (!candidates.length || refresh) {
  candidates = await fetchCandidates();
  writeFileSync(CANDIDATES, candidates.map((c) => JSON.stringify(c)).join("\n") + "\n");
} else {
  console.log(`using ${candidates.length} candidates from ${CANDIDATES} (--refresh to refetch)`);
}

const selected = select(candidates);
const body = selected.map((q) => JSON.stringify(q)).join("\n") + "\n";
if (existsSync(QUERIES_FILE) && readFileSync(QUERIES_FILE, "utf8") === body) console.log(`${QUERIES_FILE} unchanged`);
else writeFileSync(QUERIES_FILE, body);

console.log("\nintent        candidates  dev  test");
for (const intent of INTENTS) {
  const n = (split: string) => selected.filter((q) => q.intent === intent && q.split === split).length;
  console.log(`${intent.padEnd(13)} ${String(candidates.filter((c) => c.intent === intent).length).padStart(10)} ${String(n("dev")).padStart(4)} ${String(n("test")).padStart(5)}`);
}
