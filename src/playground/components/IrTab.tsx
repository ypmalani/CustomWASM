import type { IRModule } from "../../compiler/ir.js";
import { irToTree } from "../lib/irToTree.js";
import { TreeView } from "./TreeView.js";

interface IrTabProps {
  ir: IRModule | null;
}

export function IrTab({ ir }: IrTabProps) {
  if (ir === null) {
    return (
      <div data-testid="ir-tab" className="p-4 text-sm text-slate-400">
        Fix errors to generate IR.
      </div>
    );
  }

  return (
    <div data-testid="ir-tab" className="h-full overflow-auto">
      <TreeView node={irToTree(ir)} />
    </div>
  );
}
