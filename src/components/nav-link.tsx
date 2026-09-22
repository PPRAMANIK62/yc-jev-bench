"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink() {
  const onReport = usePathname().startsWith("/report");
  return (
    <Link
      href={onReport ? "/" : "/report"}
      className="group text-[15px] text-muted-ink transition-colors duration-[120ms] hover:text-ink"
    >
      {onReport ? "Try the search" : "Read the benchmark"}{" "}
      <span aria-hidden className="text-arm-jev">→</span>
    </Link>
  );
}
