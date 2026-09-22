import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FORMULATIONS, type Formulation, type Pilot, type PilotArm } from "./domain";

export const pilotFile = (arm: PilotArm) => `data/pilot-${arm}.json`;

// Used until bench/pilot.ts has run for the arm. Jev per_pair is the TypeSafe rerank cookbook's method and
// avoids the large-state accuracy drop the Jev 1.13 notes warn about; Haiku batch_100 is one call per search.
const BEFORE_PILOT: { [A in PilotArm]: Formulation<A> } = { jev: "per_pair", haiku: "batch_100" };

export function readPilot<A extends PilotArm>(arm: A): Pilot<A> | null {
  const path = join(process.cwd(), pilotFile(arm));
  if (!existsSync(path)) return null;
  const pilot = JSON.parse(readFileSync(path, "utf8")) as Pilot<A>;
  if (!(FORMULATIONS[arm] as readonly string[]).includes(pilot.chosen)) throw new Error(`${pilotFile(arm)}: unknown formulation ${pilot.chosen}`);
  return pilot;
}

export const chosenFormulation = <A extends PilotArm>(arm: A): Formulation<A> => readPilot(arm)?.chosen ?? BEFORE_PILOT[arm];

// Narrows a formulation handed across the RERANKERS registry to the one arm that owns it.
export function formulationFor<A extends PilotArm>(arm: A, formulation: Formulation | undefined): Formulation<A> {
  if (formulation === undefined) return chosenFormulation(arm);
  if (!(FORMULATIONS[arm] as readonly string[]).includes(formulation)) throw new Error(`${formulation} is not a ${arm} formulation`);
  return formulation as Formulation<A>;
}
