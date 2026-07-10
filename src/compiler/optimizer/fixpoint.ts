import type { IRModule } from "../ir.js";

export interface Pass {
  name: string;
  run(ir: IRModule): IRModule;
}

/** Deep structural equality for IR modules (JSON-serializable trees). */
export function irEqual(a: IRModule, b: IRModule): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}

/**
 * Convert Uint8Array data segments to plain arrays so JSON.stringify works.
 */
function canonicalize(ir: IRModule): unknown {
  return {
    ...ir,
    dataSegments: ir.dataSegments.map((seg) => ({
      offset: seg.offset,
      bytes: Array.from(seg.bytes),
    })),
  };
}

export interface FixpointResult {
  ir: IRModule;
  /** Number of full pass-list iterations until stability (or budget). */
  iterations: number;
}

/**
 * Run `passes` repeatedly until the IR stops changing or `budget` iterations
 * are exhausted. Throws on budget exhaustion (safety net — should not happen
 * for the default passes).
 */
export function runToFixpoint(
  ir: IRModule,
  passes: Pass[],
  budget = 20,
): FixpointResult {
  let current = ir;
  let iterations = 0;

  while (iterations < budget) {
    let next = current;
    for (const pass of passes) {
      next = pass.run(next);
    }
    iterations++;
    if (irEqual(current, next)) {
      return { ir: next, iterations };
    }
    current = next;
  }

  throw new Error(
    `optimizer: fixpoint not reached within budget of ${budget} iterations`,
  );
}
