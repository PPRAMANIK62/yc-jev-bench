import { INTENTS, type CalibrationBin, type Grade, type Intent, type Interval } from "./domain";

// Grades aligned with a ranking; null = never graded, counted as 0.
export type RankedGrades = (Grade | null)[];

const gain = (g: Grade | null) => 2 ** (g ?? 0) - 1;

function dcg(grades: (Grade | null)[]): number {
  return grades.reduce<number>((s, g, i) => s + gain(g) / Math.log2(i + 2), 0);
}

// allGrades: every grade known for this query, which defines the ideal ranking.
export function ndcgAt(ranked: RankedGrades, allGrades: Grade[], k = 10): number {
  const ideal = dcg([...allGrades].sort((a, b) => b - a).slice(0, k));
  return ideal === 0 ? 0 : dcg(ranked.slice(0, k)) / ideal;
}

export function recallAt(ranked: RankedGrades, allGrades: Grade[], k = 10): number | null {
  const exact = allGrades.filter((g) => g === 2).length;
  if (!exact) return null;
  return ranked.slice(0, k).filter((g) => g === 2).length / exact;
}

export function reciprocalRank(ranked: RankedGrades): number {
  const i = ranked.findIndex((g) => g !== null && g >= 1);
  return i < 0 ? 0 : 1 / (i + 1);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function bootstrap(values: number[], resamples = 1000, seed = 20260922): Interval {
  if (!values.length) return { mean: NaN, lo: NaN, hi: NaN };
  const rand = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < values.length; i++) s += values[Math.floor(rand() * values.length)];
    means.push(s / values.length);
  }
  means.sort((a, b) => a - b);
  return { mean: mean(values), lo: means[Math.floor(0.025 * resamples)], hi: means[Math.ceil(0.975 * resamples) - 1] };
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export function confusionMatrix(pairs: { actual: Intent; predicted: Intent }[]): number[][] {
  const m = INTENTS.map(() => INTENTS.map(() => 0));
  for (const { actual, predicted } of pairs) m[INTENTS.indexOf(actual)][INTENTS.indexOf(predicted)]++;
  return m;
}

export function calibrationBins(points: { confidence: number; correct: boolean }[], width = 0.1): CalibrationBin[] {
  const n = Math.round(1 / width);
  return Array.from({ length: n }, (_, b) => {
    const lo = b * width;
    const hi = (b + 1) * width;
    const inBin = points.filter((p) => (b === n - 1 ? p.confidence >= lo : p.confidence >= lo && p.confidence < hi));
    return {
      lo: +lo.toFixed(2),
      hi: +hi.toFixed(2),
      n: inBin.length,
      meanConfidence: mean(inBin.map((p) => p.confidence)),
      accuracy: mean(inBin.map((p) => (p.correct ? 1 : 0))),
    };
  }).filter((b) => b.n > 0);
}

export function cohenKappa(pairs: [Grade, Grade][]): number {
  const n = pairs.length;
  if (!n) return NaN;
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  let expected = 0;
  for (const g of [0, 1, 2] as Grade[]) {
    expected += (pairs.filter(([a]) => a === g).length / n) * (pairs.filter(([, b]) => b === g).length / n);
  }
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}
