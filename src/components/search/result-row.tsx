"use client";

import { motion } from "motion/react";
import type { Company } from "@/lib/domain";
import { TOP, type Row } from "./search-state";

const GLIDE = { type: "spring", stiffness: 380, damping: 34 } as const;
const SETTLE_S = 0.42;
const STAGGER_S = 0.018;

export function ResultRow({ row, index }: { row: Row; index: number }) {
  const { company, rank, reranked } = row;
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10, transition: { duration: 0.16, ease: [0.23, 1, 0.32, 1] } }}
      transition={{ layout: GLIDE, default: { ...GLIDE, delay: reranked ? 0 : index * 0.03 } }}
      className="group relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 border-b border-rule py-4 [grid-template-areas:'rank_main'_'._delta'] sm:grid-cols-[2.75rem_8rem_minmax(0,1fr)_auto] sm:gap-x-4 sm:[grid-template-areas:'rank_delta_main_meta']"
    >
      <span
        className={`font-mono text-[15px] tnum pt-[3px] [grid-area:rank] ${reranked ? "text-ink" : "text-muted-ink"}`}
        aria-label={`Rank ${rank}`}
      >
        {rank}
      </span>
      <span className="font-mono text-[11.5px] tracking-[0.02em] pt-1.5 [grid-area:delta] sm:pt-[5px]">
        {reranked ? (
          <motion.span
            key="delta"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: SETTLE_S + index * STAGGER_S }}
            className="inline-block"
          >
            <Delta row={row} />
          </motion.span>
        ) : null}
      </span>
      <div className="min-w-0 [grid-area:main]">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <a
            href={company.ycUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[17px] font-semibold leading-snug text-ink after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-[10px] focus-visible:after:outline-2 focus-visible:after:outline-arm-jev"
          >
            {company.name}
          </a>
          {company.batchShort ? <span className="label text-muted-ink">{company.batchShort}</span> : null}
          {company.status !== "Active" ? (
            <span className="label rounded-full border border-rule px-2 py-px text-muted-ink">{company.status}</span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-[15px] leading-snug text-muted-ink">{company.oneLiner || company.description}</p>
        <Meta company={company} className="mt-2 sm:hidden" />
      </div>
      <Meta company={company} className="hidden pt-[5px] text-right [grid-area:meta] sm:block" />
    </motion.li>
  );
}

function Delta({ row }: { row: Row }) {
  if (row.retrievalRank > TOP) {
    return <span className="text-arm-jev">new · was #{row.retrievalRank}</span>;
  }
  const d = row.retrievalRank - row.rank;
  if (d > 0) return <span className="text-arm-jev" aria-label={`up ${d} from retrieval`}>↑{d}</span>;
  if (d < 0) return <span className="text-muted-ink" aria-label={`down ${-d} from retrieval`}>↓{-d}</span>;
  return <span className="text-muted-ink" aria-label="same as retrieval">—</span>;
}

function Meta({ company, className }: { company: Company; className: string }) {
  const parts = [
    company.teamSize ? `${company.teamSize} people` : null,
    company.isHiring ? "hiring" : null,
    company.isOpenSource ? "open source" : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className={`label whitespace-nowrap text-muted-ink ${className}`}>{parts.join(" · ")}</p>;
}
