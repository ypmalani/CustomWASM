import type {
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "../../compiler/ir.js";
import type { TreeNode } from "./astToTree.js";

/** Convert an IR module into a collapsible TreeNode hierarchy. */
export function irToTree(ir: IRModule): TreeNode {
  const children: TreeNode[] = [];

  if (ir.imports.length > 0) {
    children.push({
      label: "Imports",
      children: ir.imports.map((imp) => ({
        label: "Import",
        detail: `${imp.module}.${imp.name}`,
        children: [],
      })),
    });
  }

  children.push({
    label: "Functions",
    children: ir.functions.map(functionToTree),
  });

  if (ir.dataSegments.length > 0) {
    children.push({
      label: "DataSegments",
      detail: String(ir.dataSegments.length),
      children: [],
    });
  }

  children.push({
    label: "Memory",
    detail: `pages=${ir.memoryPages} heapBase=${ir.heapBase}`,
    children: [],
  });

  return { label: "IRModule", children };
}

function functionToTree(fn: IRFunction): TreeNode {
  const children: TreeNode[] = [];
  if (fn.params.length > 0) {
    children.push({
      label: "Params",
      detail: fn.params.join(", "),
      children: [],
    });
  }
  if (fn.locals.length > 0) {
    children.push({
      label: "Locals",
      detail: fn.locals.map((t, i) => `${fn.params.length + i}:${t}`).join(", "),
      children: [],
    });
  }
  if (fn.result) {
    children.push({ label: "Result", detail: fn.result, children: [] });
  }
  children.push({
    label: "Body",
    children: fn.body.map(stmtToTree),
  });
  const exportMark = fn.exported ? " export" : "";
  return {
    label: "Function",
    detail: `${fn.name}${exportMark}`,
    children,
  };
}

function stmtToTree(stmt: IRStmt): TreeNode {
  switch (stmt.kind) {
    case "Block":
      return {
        label: "Block",
        detail: `label=${stmt.label}`,
        children: stmt.body.map(stmtToTree),
      };
    case "Loop":
      return {
        label: "Loop",
        detail: `label=${stmt.label}`,
        children: stmt.body.map(stmtToTree),
      };
    case "IfStmt": {
      const children: TreeNode[] = [
        { label: "Cond", children: [exprToTree(stmt.cond)] },
        { label: "Then", children: stmt.then.map(stmtToTree) },
      ];
      if (stmt.else_) {
        children.push({ label: "Else", children: stmt.else_.map(stmtToTree) });
      }
      return { label: "IfStmt", children };
    }
    case "Br":
      return { label: "Br", detail: `target=${stmt.target}`, children: [] };
    case "BrIf":
      return {
        label: "BrIf",
        detail: `target=${stmt.target}`,
        children: [exprToTree(stmt.cond)],
      };
    case "LocalSet":
      return {
        label: "LocalSet",
        detail: `index=${stmt.index}`,
        children: [exprToTree(stmt.value)],
      };
    case "Store":
      return {
        label: "Store",
        detail: `${stmt.type}${stmt.byte ? " byte" : ""} offset=${stmt.offset}`,
        children: [exprToTree(stmt.addr), exprToTree(stmt.value)],
      };
    case "CallStmt":
      return {
        label: "CallStmt",
        detail: `func=${stmt.funcIndex}`,
        children: stmt.args.map(exprToTree),
      };
    case "Drop":
      return { label: "Drop", children: [exprToTree(stmt.value)] };
    case "Return":
      return {
        label: "Return",
        children: stmt.value ? [exprToTree(stmt.value)] : [],
      };
    case "Unreachable":
      return { label: "Unreachable", children: [] };
    default: {
      const _exhaustive: never = stmt;
      return {
        label: `Unknown(${(_exhaustive as IRStmt).kind})`,
        children: [],
      };
    }
  }
}

function exprToTree(expr: IRExpr): TreeNode {
  switch (expr.kind) {
    case "Const":
      return {
        label: "Const",
        detail: `${expr.type} ${formatValue(expr.type, expr.value)}`,
        children: [],
      };
    case "LocalGet":
      return {
        label: "LocalGet",
        detail: `${expr.type} index=${expr.index}`,
        children: [],
      };
    case "BinOp":
      return {
        label: "BinOp",
        detail: `${expr.type}.${expr.op}`,
        children: [exprToTree(expr.left), exprToTree(expr.right)],
      };
    case "UnOp":
      return {
        label: "UnOp",
        detail: `${expr.type}.${expr.op}`,
        children: [exprToTree(expr.operand)],
      };
    case "CallExpr":
      return {
        label: "CallExpr",
        detail: `${expr.type} func=${expr.funcIndex}`,
        children: expr.args.map(exprToTree),
      };
    case "Load":
      return {
        label: "Load",
        detail: `${expr.type}${expr.byte ? " byte" : ""} offset=${expr.offset}`,
        children: [exprToTree(expr.addr)],
      };
    case "DataPtr":
      return {
        label: "DataPtr",
        detail: `offset=${expr.segmentOffset}`,
        children: [],
      };
    case "IfExpr":
      return {
        label: "IfExpr",
        detail: expr.type,
        children: [
          { label: "Cond", children: [exprToTree(expr.cond)] },
          { label: "Then", children: [exprToTree(expr.then)] },
          { label: "Else", children: [exprToTree(expr.else_)] },
        ],
      };
    case "Alloc":
      return {
        label: "Alloc",
        detail: "i32",
        children: [exprToTree(expr.size)],
      };
    case "BlockExpr":
      return {
        label: "BlockExpr",
        detail: expr.type,
        children: [
          { label: "Body", children: expr.body.map(stmtToTree) },
          { label: "Result", children: [exprToTree(expr.result)] },
        ],
      };
    default: {
      const _exhaustive: never = expr;
      return {
        label: `Unknown(${(_exhaustive as IRExpr).kind})`,
        children: [],
      };
    }
  }
}

function formatValue(type: WasmType, value: number): string {
  if (type === "i32") return String(value);
  return Number.isInteger(value) ? `${value}.0` : String(value);
}
