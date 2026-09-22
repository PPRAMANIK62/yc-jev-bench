const grouped = new Intl.NumberFormat("en-US");

export function int(n: number): string {
  return grouped.format(Math.round(n));
}

export function metric(n: number): string {
  return n.toFixed(2);
}

export function pct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function ms(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)} s`;
  if (n >= 100) return `${grouped.format(Math.round(n))} ms`;
  if (n >= 10) return `${n.toFixed(0)} ms`;
  return `${n.toFixed(1)} ms`;
}

export function usd(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1000) return `$${grouped.format(Math.round(n))}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  const digits = Math.max(2, 1 - Math.floor(Math.log10(n)));
  return `$${n.toFixed(Math.min(digits, 8))}`;
}

export function times(ratio: number): string {
  if (ratio >= 100) return `${grouped.format(Math.round(ratio))}×`;
  if (ratio >= 10) return `${ratio.toFixed(0)}×`;
  return `${ratio.toFixed(1)}×`;
}
