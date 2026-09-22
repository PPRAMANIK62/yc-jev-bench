const K1 = 1.2;
const B = 0.75;

const STOPWORDS = new Set(
  "a an and are as at be by for from has have i in is it its of on or that the this to was we with you your our their who what which can do does any there".split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? []).filter((t) => !STOPWORDS.has(t));
}

export interface Bm25Index {
  postings: Map<string, { doc: number; tf: number }[]>;
  docLen: Float32Array;
  avgLen: number;
}

export function buildBm25(docs: string[]): Bm25Index {
  const postings = new Map<string, { doc: number; tf: number }[]>();
  const docLen = new Float32Array(docs.length);
  docs.forEach((text, doc) => {
    const tokens = tokenize(text);
    docLen[doc] = tokens.length;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      let list = postings.get(t);
      if (!list) postings.set(t, (list = []));
      list.push({ doc, tf: n });
    }
  });
  const avgLen = docLen.reduce((a, b) => a + b, 0) / Math.max(1, docs.length);
  return { postings, docLen, avgLen };
}

export function bm25Scores(index: Bm25Index, query: string): Float32Array {
  const n = index.docLen.length;
  const scores = new Float32Array(n);
  for (const term of new Set(tokenize(query))) {
    const list = index.postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5));
    for (const { doc, tf } of list) {
      const norm = 1 - B + (B * index.docLen[doc]) / index.avgLen;
      scores[doc] += (idf * tf * (K1 + 1)) / (tf + K1 * norm);
    }
  }
  return scores;
}
