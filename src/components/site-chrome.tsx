import Link from "next/link";
import { REPO_URL } from "@/lib/links";
import { NavLink } from "./nav-link";

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

// Unauthenticated GitHub API, cached for an hour, so the header never waits on it and the rate limit is never a risk.
async function stars(): Promise<number | null> {
  try {
    const res = await fetch("https://api.github.com/repos/PPRAMANIK62/yc-jev-bench", {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const count = (await res.json()).stargazers_count;
    return typeof count === "number" && count > 0 ? count : null;
  } catch {
    return null;
  }
}

export async function SiteHeader() {
  const count = await stars();
  return (
    <header className="mx-auto w-full max-w-[1100px] px-4 sm:px-8">
      <div className="flex items-baseline justify-between gap-4 border-b border-rule py-5">
        <Link href="/" className="narrow text-[19px] font-semibold text-ink">
          yc <span className="text-muted-ink">×</span> jev
        </Link>
        <div className="flex items-baseline gap-5">
          <a
            className="flex items-center gap-1.5 self-center text-muted-ink transition-colors duration-[120ms] hover:text-ink"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Source on GitHub"
            title="Source on GitHub"
          >
            <GitHubMark />
            {count === null ? null : <span className="label text-[12px] tabular-nums">{count}</span>}
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
