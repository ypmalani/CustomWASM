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
    <div data-testid="ast-tab" className="h-full overflow-auto bg-ink">
      {hasErrors && (
        <p className="border-b border-copper/30 bg-copper/10 px-3 py-2 text-xs text-copper">
          Parse errors present — showing partial AST.
        </p>
      )}
      <TreeView node={tree} />
    </div>
  );
}
