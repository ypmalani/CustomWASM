import type { Program } from "../../compiler/ast.js";
import { astToTree } from "../lib/astToTree.js";
import { TreeView } from "./TreeView.js";

interface AstTabProps {
  ast: Program;
  hasErrors: boolean;
}

export function AstTab({ ast, hasErrors }: AstTabProps) {
  const tree = astToTree(ast);

  return (
    <div data-testid="ast-tab" className="h-full overflow-auto">
      {hasErrors && (
        <p className="border-b border-amber-900/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          Parse errors present — showing partial AST.
        </p>
      )}
      <TreeView node={tree} />
    </div>
  );
}
