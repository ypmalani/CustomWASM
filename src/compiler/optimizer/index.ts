import type { IRExpr, IRModule, IRStmt } from "../ir.js";
import { constantFold } from "./constantFold.js";
import { deadCodeElimination } from "./dce.js";
import { runToFixpoint, type Pass } from "./fixpoint.js";

export type { Pass } from "./fixpoint.js";
export { constantFold } from "./constantFold.js";
export { deadCodeElimination } from "./dce.js";
export { irEqual, runToFixpoint } from "./fixpoint.js";
export type { FixpointResult } from "./fixpoint.js";

/** Default pass pipeline: fold then DCE, iterated to fixpoint. */
export const DEFAULT_PASSES: Pass[] = [constantFold, deadCodeElimination];

/**
 * Optimize an IR module by running `passes` to fixpoint (or a budget).
 * Default passes: constant folding + dead code elimination.
 * Every pass is a pure IRModule → IRModule transform; input is never mutated.
 */
export function optimize(
  ir: IRModule,
  passes: Pass[] = DEFAULT_PASSES,
): IRModule {
  return runToFixpoint(ir, passes).ir;
}

/**
 * Count IR "instructions" — every statement node plus every expression node.
 * Used by the playground and tests to assert measurable reduction.
 */
export function countInstructions(ir: IRModule): number {
  let count = 0;
  for (const fn of ir.functions) {
    count += countStmts(fn.body);
  }
  return count;
}

function countStmts(stmts: IRStmt[]): number {
  let n = 0;
  for (const stmt of stmts) {
    n += 1;
    switch (stmt.kind) {
      case "Block":
      case "Loop":
        n += countStmts(stmt.body);
        break;
      case "IfStmt":
        n += countExpr(stmt.cond);
        n += countStmts(stmt.then);
        if (stmt.else_) n += countStmts(stmt.else_);
        break;
      case "Br":
        break;
      case "BrIf":
        n += countExpr(stmt.cond);
        break;
      case "LocalSet":
        n += countExpr(stmt.value);
        break;
      case "Store":
        n += countExpr(stmt.addr);
        n += countExpr(stmt.value);
        break;
      case "CallStmt":
        for (const a of stmt.args) n += countExpr(a);
        break;
      case "Drop":
        n += countExpr(stmt.value);
        break;
      case "Return":
        if (stmt.value) n += countExpr(stmt.value);
        break;
      case "Unreachable":
        break;
      default: {
        const _exhaustive: never = stmt;
        throw new Error(
          `countInstructions: unhandled stmt ${(_exhaustive as IRStmt).kind}`,
        );
      }
    }
  }
  return n;
}

function countExpr(expr: IRExpr): number {
  let n = 1;
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      break;
    case "BinOp":
      n += countExpr(expr.left);
      n += countExpr(expr.right);
      break;
    case "UnOp":
      n += countExpr(expr.operand);
      break;
    case "CallExpr":
      for (const a of expr.args) n += countExpr(a);
      break;
    case "Load":
      n += countExpr(expr.addr);
      break;
    case "IfExpr":
      n += countExpr(expr.cond);
      n += countExpr(expr.then);
      n += countExpr(expr.else_);
      break;
    case "Alloc":
      n += countExpr(expr.size);
      break;
    case "BlockExpr":
      n += countStmts(expr.body);
      n += countExpr(expr.result);
      break;
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `countInstructions: unhandled expr ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
  return n;
}
