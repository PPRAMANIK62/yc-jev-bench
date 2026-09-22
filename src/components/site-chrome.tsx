import Link from "next/link";
import { REPO_URL } from "@/lib/links";
import { NavLink } from "./nav-link";

export function SiteHeader() {
  return (
    <header className="mx-auto w-full max-w-[1100px] px-4 sm:px-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule py-5">
        <Link href="/" className="narrow text-[19px] font-semibold text-ink">
          yc <span className="text-muted-ink">×</span> jev
        </Link>
        <div className="flex items-baseline gap-5">
          <a
            className="label text-muted-ink transition-colors duration-[120ms] hover:text-ink"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            code <span aria-hidden>↗</span>
          </a>
          <NavLink />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-24 w-full max-w-[1100px] px-4 sm:px-8">
      <div className="label flex flex-col gap-2 border-t border-rule py-6 leading-relaxed text-muted-ink sm:flex-row sm:justify-between">
        <p className="max-w-[62ch]">
          Company data is an unofficial mirror of YC&rsquo;s public directory (
          <a className="underline decoration-rule underline-offset-2 hover:decoration-ink" href="https://github.com/yc-oss/api">
            yc-oss/api
          </a>
          ), snapshot 2026-09-22. Not affiliated with Y Combinator or TypeSafe.
        </p>
        <p className="shrink-0">
          An independent benchmark ·{" "}
          <a className="underline decoration-rule underline-offset-2 hover:decoration-ink" href={REPO_URL}>
            source on GitHub
          </a>
        </p>
      </div>
    </footer>
  );
}
