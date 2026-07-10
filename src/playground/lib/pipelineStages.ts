import type { CompileResult } from "../../compiler/pipeline.js";

export const PIPELINE_STAGES = [
  "lex",
  "parse",
  "check",
  "lower",
  "opt",
  "emit",
] as const;

export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<PipelineStageId, string> = {
  lex: "Lex",
  parse: "Parse",
  check: "Check",
  lower: "Lower",
  opt: "Opt",
  emit: "Emit",
};

export interface PipelineRailState {
  /** Last stage that completed successfully (inclusive). Null if Lex failed. */
  completedThrough: PipelineStageId | null;
  /** Stage where the pipeline stopped with an error. */
  failedAt: PipelineStageId | null;
}

/**
 * Derive which pipeline stages succeeded / failed from compile artifacts.
 * Matches pipeline.ts skip rules: later stages are skipped when diagnostics exist.
 *
 * Note: typecheck returns `typedProgram: null` when it reports errors, same as
 * when parse errors skip typecheck — distinguish via diagnostic message shape.
 */
export function resolvePipelineState(result: CompileResult): PipelineRailState {
  const hasLexError = result.tokens.some((t) => t.type === "Error");
  if (hasLexError) {
    return { completedThrough: null, failedAt: "lex" };
  }

  if (result.diagnostics.length > 0 && result.ir === null) {
    // Lower/emit catch uses an empty span and only runs after a typed AST exists.
    const looksLikeLower =
      result.typedAst !== null &&
      result.diagnostics.every((d) => d.span.start === 0 && d.span.end === 0);
    if (looksLikeLower) {
      return { completedThrough: "check", failedAt: "lower" };
    }

    // Parse diagnostics typically "expected X, found Y"; typecheck does not.
    const looksLikeParse = result.diagnostics.some((d) =>
      /\bexpected\b|\bunexpected\b/i.test(d.message),
    );
    if (looksLikeParse) {
      return { completedThrough: "lex", failedAt: "parse" };
    }
    return { completedThrough: "parse", failedAt: "check" };
  }

  if (
    result.ir !== null &&
    result.wat !== null &&
    result.optimizedIr !== null &&
    result.optimizedWat !== null
  ) {
    return { completedThrough: "emit", failedAt: null };
  }

  if (result.ir !== null && result.wat !== null) {
    return { completedThrough: "opt", failedAt: "emit" };
  }

  if (result.ir !== null) {
    return { completedThrough: "lower", failedAt: "opt" };
  }

  return { completedThrough: "check", failedAt: "lower" };
}

export function stageIndex(id: PipelineStageId): number {
  return PIPELINE_STAGES.indexOf(id);
}
