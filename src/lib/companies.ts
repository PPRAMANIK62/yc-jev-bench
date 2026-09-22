import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Company, CompanyId, CompanyStatus } from "./domain";

export const SNAPSHOT = "data/companies-2026-09-22.json";

interface RawCompany {
  id: number;
  name: string;
  slug: string;
  small_logo_thumb_url: string | null;
  website: string | null;
  all_locations: string | null;
  long_description: string | null;
  one_liner: string | null;
  team_size: number | null;
  industry: string | null;
  subindustry: string | null;
  tags: string[];
  isHiring: boolean;
  batch: string;
  status: CompanyStatus;
  regions: string[];
  url: string;
}

const SEASON: Record<string, string> = { Winter: "W", Summer: "S", Fall: "F", Spring: "X" };
const STATUSES: readonly CompanyStatus[] = ["Active", "Inactive", "Acquired", "Public"];

export function batchShort(batch: string): string {
  if (batch === "Unspecified") return "";
  const m = /^(Winter|Summer|Fall|Spring) (\d{4})$/.exec(batch);
  if (!m) throw new Error(`unknown YC batch string: ${JSON.stringify(batch)}`);
  return SEASON[m[1]] + m[2].slice(2);
}

function normalize(r: RawCompany): Company {
  if (!STATUSES.includes(r.status)) throw new Error(`unknown status ${r.status} on company ${r.id}`);
  const oneLiner = (r.one_liner ?? "").trim();
  const long = (r.long_description ?? "").trim();
  return {
    id: r.id as CompanyId,
    name: r.name,
    slug: r.slug,
    oneLiner,
    description: long || oneLiner,
    industry: r.industry ?? "",
    subindustry: r.subindustry ?? "",
    tags: r.tags ?? [],
    batch: r.batch,
    batchShort: batchShort(r.batch),
    status: r.status,
    teamSize: r.team_size || null,
    location: r.all_locations ?? "",
    regions: r.regions ?? [],
    isHiring: r.isHiring,
    isOpenSource: (r.tags ?? []).includes("Open Source"),
    website: r.website ?? "",
    ycUrl: r.url,
    logoUrl: r.small_logo_thumb_url ?? "",
  };
}

let cache: { list: Company[]; byId: Map<number, Company> } | null = null;

function load() {
  if (!cache) {
    const raw = JSON.parse(readFileSync(join(process.cwd(), SNAPSHOT), "utf8")) as RawCompany[];
    const list = raw.map(normalize);
    cache = { list, byId: new Map(list.map((c) => [c.id, c])) };
  }
  return cache;
}

export function loadCompanies(): Company[] {
  return load().list;
}

export function companyById(id: CompanyId): Company {
  const c = load().byId.get(id);
  if (!c) throw new Error(`no company with id ${id}`);
  return c;
}
