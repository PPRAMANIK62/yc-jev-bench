import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Results } from "./domain";

const REAL = "src/generated/results.json";
const FIXTURE = "src/generated/results.fixture.json";

// Read at request/build time rather than imported, so the real file wins the moment bench/score.ts writes it.
export function loadResults(): Results | null {
  for (const file of [REAL, FIXTURE]) {
    const path = join(process.cwd(), file);
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Results;
  }
  return null;
}
