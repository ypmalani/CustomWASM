import { useEffect, useState } from "react";
import type { CompileResult } from "../../compiler/pipeline.js";
import {
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABELS,
  resolvePipelineState,
  stageIndex,
  type PipelineStageId,
} from "../lib/pipelineStages.js";

const CASCADE_MS = 50;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface PipelineStageRailProps {
  result: CompileResult;
}

/**
 * Signature element: lights Lex → Emit in cascade on each recompile.
 */
export function PipelineStageRail({ result }: PipelineStageRailProps) {
  const final = resolvePipelineState(result);
  const [litThrough, setLitThrough] = useState<number>(() =>
    final.failedAt !== null
      ? stageIndex(final.failedAt)
      : stageIndex(final.completedThrough ?? "lex"),
  );

  useEffect(() => {
    const state = resolvePipelineState(result);
    const targetIdx =
      state.failedAt !== null
        ? stageIndex(state.failedAt)
        : stageIndex(state.completedThrough ?? "lex");

    if (prefersReducedMotion()) {
      setLitThrough(targetIdx);
      return;
    }

    setLitThrough(-1);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i <= targetIdx; i++) {
      timers.push(
        setTimeout(() => {
          setLitThrough(i);
        }, CASCADE_MS * (i + 1)),
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [result]);

  return (
    <div
      data-testid="pipeline-stage-rail"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-rule bg-panel px-4 py-1.5"
      role="status"
      aria-label="Compiler pipeline stages"
    >
      {PIPELINE_STAGES.map((id, i) => {
        const status = stageVisualStatus(id, i, litThrough, final);
        return (
          <div key={id} className="flex items-center gap-1">
            {i > 0 && (
              <span
                className="mx-0.5 text-[10px] text-muted select-none"
                aria-hidden
              >
                →
              </span>
            )}
            <span
              className={stageClassName(status)}
              data-stage={id}
              data-status={status}
            >
              {PIPELINE_STAGE_LABELS[id]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type StageVisual = "inert" | "lit" | "done" | "failed" | "pending";

function stageVisualStatus(
  id: PipelineStageId,
  index: number,
  litThrough: number,
  final: ReturnType<typeof resolvePipelineState>,
): StageVisual {
  const failIdx = final.failedAt !== null ? stageIndex(final.failedAt) : -1;
  const doneIdx =
    final.completedThrough !== null ? stageIndex(final.completedThrough) : -1;

  if (final.failedAt === id && index <= litThrough) {
    return "failed";
  }
  if (index > litThrough) {
    return "pending";
  }
  // Cascade still running toward target
  if (litThrough < (failIdx >= 0 ? failIdx : doneIdx)) {
    return "lit";
  }
  // Settled
  if (final.failedAt !== null) {
    if (index < failIdx) return "done";
    if (index === failIdx) return "failed";
    return "inert";
  }
  if (index < doneIdx) return "done";
  if (index === doneIdx) return "lit"; // soft signal mark on last
  return "inert";
}

function stageClassName(status: StageVisual): string {
  const base =
    "font-sans text-[11px] font-medium tracking-wide uppercase whitespace-nowrap rounded px-1.5 py-0.5";
  switch (status) {
    case "lit":
      return `${base} pipeline-stage--lit text-signal`;
    case "done":
      return `${base} text-steel`;
    case "failed":
      return `${base} text-error`;
    case "pending":
      return `${base} text-muted opacity-40`;
    case "inert":
    default:
      return `${base} text-muted opacity-40`;
  }
}
