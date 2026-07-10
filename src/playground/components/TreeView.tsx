import { useState } from "react";
import type { TreeNode } from "../lib/astToTree.js";

interface TreeViewProps {
  node: TreeNode;
  /** When true, start expanded (default true for root). */
  defaultExpanded?: boolean;
}

function TreeNodeView({
  node,
  defaultExpanded = true,
  depth = 0,
}: {
  node: TreeNode;
  defaultExpanded?: boolean;
  depth?: number;
}) {
  const hasChildren = node.children.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="font-mono text-sm" style={{ paddingLeft: depth === 0 ? 0 : 12 }}>
      <div className="flex items-start gap-1 py-0.5">
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${node.label}` : `Expand ${node.label}`}
            aria-expanded={expanded}
            className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 shrink-0" aria-hidden />
        )}
        <span className="text-sky-300">{node.label}</span>
        {node.detail !== undefined && (
          <span className="text-amber-200"> {node.detail}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child, i) => (
            <TreeNodeView
              key={`${child.label}-${i}`}
              node={child}
              defaultExpanded={true}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Recursive collapsible tree over TreeNode — reusable by AST and (later) IR tabs. */
export function TreeView({ node, defaultExpanded = true }: TreeViewProps) {
  return (
    <div data-testid="tree-view" className="overflow-auto p-2">
      <TreeNodeView node={node} defaultExpanded={defaultExpanded} />
    </div>
  );
}
