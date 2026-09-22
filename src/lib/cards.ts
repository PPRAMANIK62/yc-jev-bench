import type { Company } from "./domain";

const DESCRIPTION_CHARS = 600;

function truncateAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "") + "…";
}

// The one text every reranker and the judge sees. Deterministic: no dates, no randomness.
export function companyCard(c: Company): string {
  const lines = [`${c.name}: ${c.oneLiner}`];
  if (c.description && c.description !== c.oneLiner) lines.push(truncateAtWord(c.description.replace(/\s+/g, " "), DESCRIPTION_CHARS));
  const industry = c.subindustry || c.industry;
  if (industry) lines.push(`Industry: ${industry}`);
  if (c.tags.length) lines.push(`Tags: ${c.tags.join(", ")}`);
  const facts = [
    c.batchShort && `YC ${c.batchShort}`,
    c.status,
    c.location && `based in ${c.location}`,
    c.teamSize && `${c.teamSize} people`,
    c.isHiring ? "hiring" : "not hiring",
  ].filter(Boolean);
  lines.push(facts.join(" · "));
  return lines.join("\n");
}
