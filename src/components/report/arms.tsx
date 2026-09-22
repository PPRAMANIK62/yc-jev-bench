import { ARM_SPEC, ARMS, type ArmId, type ArmResult, type Results, type RouterId, type RouterResult } from "@/lib/domain";

export const ARM_COLOR: Record<ArmId, string> = {
  none: "var(--arm-none)",
  bge: "var(--arm-bge)",
  haiku: "var(--arm-haiku)",
  jev: "var(--arm-jev)",
};

export const ARM_SHORT: Record<ArmId, string> = {
  none: "None",
  bge: "BGE",
  haiku: "Haiku",
  jev: "Jev",
};

export function armOf(results: Results, arm: ArmId): ArmResult | null {
  return results.arms.find((a) => a.arm === arm) ?? null;
}

export function routerOf(results: Results, router: RouterId): RouterResult | null {
  return results.routers.find((r) => r.router === router) ?? null;
}

export function armLabel(arm: ArmId): string {
  return ARM_SPEC[arm].label;
}


export function Swatch({ arm, shape = "dot" }: { arm: ArmId; shape?: "dot" | "line" | "bar" }) {
  const cls =
    shape === "line" ? "h-[2px] w-3.5 rounded-full" : shape === "bar" ? "h-2.5 w-2.5 rounded-[3px]" : "h-2.5 w-2.5 rounded-full";
  return <span aria-hidden className={`inline-block shrink-0 ${cls}`} style={{ background: ARM_COLOR[arm] }} />;
}

export function ArmName({ arm, short = false }: { arm: ArmId; short?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Swatch arm={arm} />
      <span>{short ? ARM_SHORT[arm] : armLabel(arm)}</span>
    </span>
  );
}

export function NotRunYet({ arm, className = "" }: { arm?: ArmId; className?: string }) {
  return (
    <span className={`label inline-flex items-center gap-2 text-muted-ink ${className}`}>
      {arm ? <span aria-hidden className="h-2.5 w-2.5 rounded-full opacity-35" style={{ background: ARM_COLOR[arm] }} /> : null}
      not run yet
    </span>
  );
}
