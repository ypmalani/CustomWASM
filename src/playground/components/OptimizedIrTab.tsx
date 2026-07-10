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
        className="p-4 font-sans text-sm text-muted"
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
      className="flex h-full flex-col overflow-hidden bg-ink"
    >
      <div className="flex shrink-0 items-center gap-4 border-b border-rule px-4 py-2 text-xs">
        <span className="text-muted">
          Unopt:{" "}
          <span className="font-mono text-copper">{unoptCount}</span>
        </span>
        <span className="text-muted">
          Opt: <span className="font-mono text-signal">{optCount}</span>
        </span>
        <span className="text-muted">
          Δ:{" "}
          <span
            className={
              delta > 0 ? "font-mono text-signal" : "font-mono text-muted"
            }
          >
            −{delta} ({pct}%)
          </span>
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-rule sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-rule px-3 py-1.5 font-sans text-[10px] font-medium tracking-[0.12em] text-muted uppercase">
            Unoptimized IR
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <TreeView node={irToTree(ir)} />
          </div>
        </div>
        <div className="flex min-h-0 flex-col overflow-hidden">
          <div className="shrink-0 border-b border-rule px-3 py-1.5 font-sans text-[10px] font-medium tracking-[0.12em] text-muted uppercase">
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
