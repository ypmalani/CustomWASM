import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { IRModule } from "../../compiler/ir.js";
import {
  type Step,
  type TraceResult,
  trace,
} from "../../compiler/stepper.js";
import { compileModule, formatOp } from "../../compiler/watOps.js";

interface StepperTabProps {
  ir: IRModule | null;
}

const SPEEDS_MS = [800, 400, 200, 80] as const;

export function StepperTab({ ir }: StepperTabProps) {
  const [traceResult, setTraceResult] = useState<TraceResult | null>(null);
  const [opLines, setOpLines] = useState<
    { funcName: string; text: string; opIndex: number }[]
  >([]);
  const [cursor, setCursor] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPlaying(false);
    if (!ir) {
      setTraceResult(null);
      setOpLines([]);
      setCursor(-1);
      return;
    }
    const compiled = compileModule(ir);
    const lines: { funcName: string; text: string; opIndex: number }[] = [];
    for (const fn of compiled.functions) {
      for (let i = 0; i < fn.ops.length; i++) {
        lines.push({
          funcName: fn.name,
          text: formatOp(fn.ops[i]!),
          opIndex: i,
        });
      }
    }
    setOpLines(lines);
    setTraceResult(trace(ir));
    setCursor(-1);
  }, [ir]);

  const step: Step | null =
    traceResult && cursor >= 0 && cursor < traceResult.steps.length
      ? traceResult.steps[cursor]!
      : null;

  const atEnd =
    !!traceResult &&
    traceResult.steps.length > 0 &&
    cursor >= traceResult.steps.length - 1;

  const tick = useEffectEvent(() => {
    setCursor((c) => {
      if (!traceResult || traceResult.steps.length === 0) return c;
      if (c >= traceResult.steps.length - 1) {
        setPlaying(false);
        return c;
      }
      return c + 1;
    });
  });

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(tick, SPEEDS_MS[speedIdx]!);
    return () => window.clearInterval(id);
  }, [playing, speedIdx, tick]);

  useEffect(() => {
    if (!step || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-op="${step.funcName}:${step.opIndex}"]`,
    );
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [step]);

  if (ir === null) {
    return (
      <div data-testid="stepper-tab" className="p-4 font-sans text-sm text-muted">
        Fix errors to step through execution.
      </div>
    );
  }

  if (!traceResult) {
    return (
      <div data-testid="stepper-tab" className="p-4 font-sans text-sm text-muted">
        Preparing trace…
      </div>
    );
  }

  const stack = step?.stack ?? [];
  const locals = step?.locals ?? [];

  return (
    <div
      data-testid="stepper-tab"
      className="flex h-full min-h-0 flex-col bg-ink"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-rule bg-panel px-3 py-2">
        <button
          type="button"
          className="rounded border border-rule px-2 py-1 font-sans text-xs text-fg hover:border-signal hover:text-signal disabled:opacity-40"
          onClick={() => {
            setPlaying(false);
            setCursor(-1);
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="rounded border border-rule px-2 py-1 font-sans text-xs text-fg hover:border-signal hover:text-signal disabled:opacity-40"
          disabled={cursor < 0}
          onClick={() => {
            setPlaying(false);
            setCursor((c) => Math.max(-1, c - 1));
          }}
        >
          ◀ Back
        </button>
        <button
          type="button"
          className="rounded border border-rule px-2 py-1 font-sans text-xs text-fg hover:border-signal hover:text-signal disabled:opacity-40"
          disabled={atEnd || traceResult.steps.length === 0}
          onClick={() => {
            setPlaying(false);
            setCursor((c) =>
              Math.min(traceResult.steps.length - 1, c + 1),
            );
          }}
        >
          Step ▶
        </button>
        <button
          type="button"
          className="rounded border border-rule px-2 py-1 font-sans text-xs text-fg hover:border-signal hover:text-signal disabled:opacity-40"
          disabled={atEnd || traceResult.steps.length === 0}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <label className="ml-2 flex items-center gap-2 font-sans text-xs text-muted">
          Speed
          <input
            type="range"
            min={0}
            max={SPEEDS_MS.length - 1}
            value={speedIdx}
            onChange={(e) => setSpeedIdx(Number(e.target.value))}
            className="w-24 accent-[var(--color-signal)]"
          />
        </label>
        <span className="ml-auto font-mono text-xs text-muted">
          {cursor < 0 ? 0 : cursor + 1}/{traceResult.steps.length}
          {traceResult.trapped ? " · trapped" : ""}
          {atEnd && traceResult.returnValue !== undefined
            ? ` · → ${traceResult.returnValue}`
            : ""}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex w-36 shrink-0 flex-col border-r border-rule">
          <div className="border-b border-rule px-2 py-1 font-sans text-[10px] uppercase tracking-wide text-muted">
            Stack
          </div>
          <div className="flex flex-1 flex-col-reverse justify-end gap-1 overflow-auto p-2">
            {stack.length === 0 ? (
              <div className="font-mono text-xs text-muted">∅</div>
            ) : (
              stack.map((v, i) => {
                const isTop = i === stack.length - 1;
                return (
                  <div
                    key={`${i}-${v.bits}`}
                    className={`stack-cell rounded border px-2 py-1 font-mono text-xs ${
                      isTop
                        ? "border-signal bg-panel text-signal"
                        : "border-rule text-steel"
                    }`}
                  >
                    {v.type === "i32" ? v.bits | 0 : v.bits}
                    {isTop ? (
                      <span className="ml-1 text-[9px] text-muted">top</span>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
          <div className="border-t border-rule px-2 py-1 font-sans text-[10px] uppercase tracking-wide text-muted">
            Locals
          </div>
          <div className="max-h-28 overflow-auto px-2 py-1 font-mono text-xs text-steel">
            {locals.length === 0 ? (
              <span className="text-muted">—</span>
            ) : (
              locals.map((v, i) => (
                <div key={i}>
                  [{i}]={v.type === "i32" ? v.bits | 0 : v.bits}
                </div>
              ))
            )}
          </div>
          {step ? (
            <div className="border-t border-rule px-2 py-1 font-mono text-[10px] text-muted">
              ${step.funcName}
            </div>
          ) : null}
        </div>

        <div ref={listRef} className="min-w-0 flex-1 overflow-auto p-2">
          <pre className="font-mono text-sm leading-5">
            {(() => {
              let lastFunc = "";
              return opLines.map((line) => {
                const active =
                  step &&
                  step.funcName === line.funcName &&
                  step.opIndex === line.opIndex;
                const header =
                  line.funcName !== lastFunc ? (
                    <div
                      key={`hdr-${line.funcName}`}
                      className="mt-2 text-muted first:mt-0"
                    >
                      (func ${line.funcName})
                    </div>
                  ) : null;
                lastFunc = line.funcName;
                return (
                  <div key={`${line.funcName}:${line.opIndex}`}>
                    {header}
                    <div
                      data-op={`${line.funcName}:${line.opIndex}`}
                      className={
                        active
                          ? "rounded bg-panel text-signal"
                          : "text-steel"
                      }
                    >
                      <span className="inline-block w-4 text-muted">
                        {active ? "▸" : " "}
                      </span>
                      {line.text}
                    </div>
                  </div>
                );
              });
            })()}
          </pre>
          {traceResult.prints.length > 0 ? (
            <div className="mt-3 border-t border-rule pt-2 font-mono text-xs text-copper">
              prints: {traceResult.prints.join(", ")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
