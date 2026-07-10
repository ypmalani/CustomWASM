import type { IRModule } from "../../compiler/ir.js";
import { irToTree } from "../lib/irToTree.js";
import { TreeView } from "./TreeView.js";

interface IrTabProps {
  ir: IRModule | null;
}

export function IrTab({ ir }: IrTabProps) {
  if (ir === null) {
    return (
      <div data-testid="ir-tab" className="p-4 font-sans text-sm text-muted">
        Fix errors to generate IR.
      </div>
    );
  }

  return (
    <div data-testid="ir-tab" className="h-full overflow-auto bg-ink">
      <TreeView node={irToTree(ir)} />
    </div>
  );
}
