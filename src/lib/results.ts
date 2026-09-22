import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Results } from "./domain";

// Read rather than imported, so the real file wins the moment bench/score.ts writes it.
// /report is prerendered, so a rebuild picks up new results.
export function loadResults(): Results | null {
  for (const name of ["results.json", "results.fixture.json"]) {
    const path = join(process.cwd(), "src", "generated", name);
    if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as Results;
  }
  return null;
}
