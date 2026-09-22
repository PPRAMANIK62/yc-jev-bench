import type { ReactNode } from "react";

export function Section({
  id,
  n,
  title,
  lede,
  wide = false,
  children,
}: {
  id: string;
  n: number;
  title: string;
  lede?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 border-t border-rule pt-8 pb-16 sm:pt-10 sm:pb-20">
      <div className="grid gap-x-10 gap-y-4 md:grid-cols-[9rem_minmax(0,1fr)]">
        <a href={`#${id}`} className="label pt-2 text-muted-ink transition-colors duration-[120ms] hover:text-ink">
          §{n}
        </a>
        <div className="min-w-0">
          <h2 id={`${id}-h`} className="narrow text-[28px] leading-tight font-semibold text-ink sm:text-[34px]">
            {title}
          </h2>
          {lede ? <div className="prose-paper mt-4 text-ink">{lede}</div> : null}
          {children && !wide ? <div className="mt-8">{children}</div> : null}
        </div>
      </div>
      {children && wide ? <div className="mt-10">{children}</div> : null}
    </section>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <figcaption className="label mt-3 max-w-[72ch] leading-relaxed text-muted-ink">{children}</figcaption>;
}

export function Pending({ children }: { children: ReactNode }) {
  return (
    <p className="label rounded-[10px] border border-dashed border-rule px-4 py-5 text-muted-ink">{children}</p>
  );
}
