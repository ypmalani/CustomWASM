import type { IRModule } from "../../compiler/ir.js";
import { countInstructions } from "../../compiler/optimizer/index.js";
import { irToTree } from "../lib/irToTree.js";
import { TreeView } from "./TreeView.js";

interface OptimizedIrTabProps {
  ir: IRModule | null;
  optimizedIr: IRModule | null;
}

export function OptimizedIrTab({ ir, optimizedIr }: OptimizedIrTabProps) {
  if (ir === null || optimizedIr === null) {
    return (
      <div
        data-testid="optimized-ir-tab"
        className="p-4 text-sm text-slate-400"
      >
        Fix errors to generate optimized IR.
      </div>
    );
  }

  const unoptCount = countInstructions(ir);
  const optCount = countInstructions(optimizedIr);
  const delta = unoptCount - optCount;
  const pct =
    unoptCount === 0 ? 0 : Math.round((delta / unoptCount) * 100);

  return (
    <div
      data-testid="optimized-ir-tab"
      className="flex h-full flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 px-4 py-2 text-xs">
        <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
          Unopt: <span className="font-mono text-amber-200">{unoptCount}</span>
        </span>
        <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
          Opt: <span className="font-mono text-emerald-300">{optCount}</span>
        </span>
        <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">
          Δ:{" "}
          <span
            className={
              delta > 0
                ? "font-mono text-emerald-300"
                : "font-mono text-slate-400"
            }
          >
            −{delta} ({pct}%)
          </span>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-slate-800">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Unoptimized IR
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TreeView node={irToTree(ir)} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-slate-800 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
            Optimized IR
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TreeView node={irToTree(optimizedIr)} />
          </div>
        </div>
      </div>
    </div>
  );
}
