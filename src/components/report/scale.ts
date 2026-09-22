export type Scale = (v: number) => number;

export function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  return (v) => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

export function log([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale {
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);
  return (v) => r0 + ((Math.log10(v) - l0) / (l1 - l0)) * (r1 - r0);
}

export function decadesAround(values: number[]): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return [10 ** Math.floor(Math.log10(lo)), 10 ** Math.ceil(Math.log10(hi))];
}

export function decadeTicks([d0, d1]: [number, number]): number[] {
  const ticks: number[] = [];
  for (let v = d0; v <= d1 * 1.0001; v *= 10) ticks.push(v);
  return ticks;
}
