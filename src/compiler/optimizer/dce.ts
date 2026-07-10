import type {
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "../ir.js";
import type { Pass } from "./fixpoint.js";

/**
 * Dead code elimination:
 * 1. Truncate statements after unconditional terminators (Return/Br/Unreachable).
 * 2. Splice in the taken arm of IfStmt with a Const condition.
 * 3. Remove Drop/LocalSet of side-effect-free values that are never read
 *    (LocalSet of unread locals; Drop of Const/LocalGet).
 * 4. Remove unread locals and re-densify indices.
 */
export const deadCodeElimination: Pass = {
  name: "deadCodeElimination",
  run(ir: IRModule): IRModule {
    return {
      ...ir,
      functions: ir.functions.map(dceFunction),
    };
  },
};

function dceFunction(fn: IRFunction): IRFunction {
  // Pass 1: structural DCE (terminators, const-cond ifs, side-effect-free drops).
  let body = dceStmts(fn.body);

  // Pass 2: remove unread locals whose writes are side-effect-free, re-densify.
  const paramCount = fn.params.length;
  const usedLocals = collectUsedLocals(body);
  const removable = new Set<number>();
  for (let i = 0; i < fn.locals.length; i++) {
    const index = paramCount + i;
    if (!usedLocals.has(index) && allWritesSideEffectFree(body, index)) {
      removable.add(index);
    }
  }

  if (removable.size > 0) {
    // Drop LocalSets to removable locals (values are side-effect-free).
    body = stripLocalSets(body, removable);
    // Re-densify: params keep 0..n-1; survivors get consecutive indices.
    const { newLocals, indexMap } = densifyLocals(
      fn.params.length,
      fn.locals,
      removable,
    );
    body = remapIndices(body, indexMap);
    return { ...fn, locals: newLocals, body };
  }

  return { ...fn, body };
}

// ---- Structural DCE ----

function dceStmts(stmts: IRStmt[]): IRStmt[] {
  const out: IRStmt[] = [];
  for (const stmt of stmts) {
    const rewritten = dceStmt(stmt);
    // Const-cond IfStmt may expand into multiple statements.
    if (Array.isArray(rewritten)) {
      for (const s of rewritten) {
        out.push(s);
        if (isTerminator(s)) break;
      }
      // If we hit a terminator inside the spliced arm, stop the outer list too.
      if (rewritten.some(isTerminator) && out.length > 0 && isTerminator(out[out.length - 1]!)) {
        break;
      }
      // More carefully: if the last pushed was a terminator, break.
      if (out.length > 0 && isTerminator(out[out.length - 1]!)) break;
    } else {
      out.push(rewritten);
      if (isTerminator(rewritten)) break;
    }
  }
  return out;
}

function dceStmt(stmt: IRStmt): IRStmt | IRStmt[] {
  switch (stmt.kind) {
    case "Block":
      return { ...stmt, body: dceStmts(stmt.body) };
    case "Loop":
      return { ...stmt, body: dceStmts(stmt.body) };
    case "IfStmt": {
      const then = dceStmts(stmt.then);
      const else_ = stmt.else_ ? dceStmts(stmt.else_) : undefined;
      // Const condition → splice taken arm (cond is side-effect-free Const).
      if (stmt.cond.kind === "Const") {
        if (stmt.cond.value !== 0) {
          return then;
        }
        return else_ ?? [];
      }
      return {
        kind: "IfStmt",
        cond: dceExpr(stmt.cond),
        then,
        else_,
      };
    }
    case "Drop":
      // Drop of a side-effect-free value is a no-op.
      if (isSideEffectFree(stmt.value)) {
        return [];
      }
      return { ...stmt, value: dceExpr(stmt.value) };
    case "LocalSet":
      return { ...stmt, value: dceExpr(stmt.value) };
    case "Store":
      return {
        ...stmt,
        addr: dceExpr(stmt.addr),
        value: dceExpr(stmt.value),
      };
    case "CallStmt":
      return { ...stmt, args: stmt.args.map(dceExpr) };
    case "Return":
      return stmt.value
        ? { ...stmt, value: dceExpr(stmt.value) }
        : stmt;
    case "BrIf":
      return { ...stmt, cond: dceExpr(stmt.cond) };
    case "Br":
    case "Unreachable":
      return stmt;
    default: {
      const _exhaustive: never = stmt;
      throw new Error(`dce: unhandled stmt ${(_exhaustive as IRStmt).kind}`);
    }
  }
}

/** Recursively DCE nested BlockExpr bodies inside expressions. */
function dceExpr(expr: IRExpr): IRExpr {
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      return expr;
    case "BinOp":
      return {
        ...expr,
        left: dceExpr(expr.left),
        right: dceExpr(expr.right),
      };
    case "UnOp":
      return { ...expr, operand: dceExpr(expr.operand) };
    case "CallExpr":
      return { ...expr, args: expr.args.map(dceExpr) };
    case "Load":
      return { ...expr, addr: dceExpr(expr.addr) };
    case "IfExpr":
      return {
        ...expr,
        cond: dceExpr(expr.cond),
        then: dceExpr(expr.then),
        else_: dceExpr(expr.else_),
      };
    case "Alloc":
      return { ...expr, size: dceExpr(expr.size) };
    case "BlockExpr":
      return {
        ...expr,
        body: dceStmts(expr.body),
        result: dceExpr(expr.result),
      };
    default: {
      const _exhaustive: never = expr;
      throw new Error(`dce: unhandled expr ${(_exhaustive as IRExpr).kind}`);
    }
  }
}

function isTerminator(stmt: IRStmt): boolean {
  return (
    stmt.kind === "Return" ||
    stmt.kind === "Br" ||
    stmt.kind === "Unreachable"
  );
}

/** Expressions with no observable side effects / traps when evaluated. */
function isSideEffectFree(expr: IRExpr): boolean {
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      return true;
    case "BinOp":
      // Conservatively: only if both sides are side-effect-free AND the op
      // cannot trap. Trap-capable ops (div/rem) are NOT side-effect-free even
      // with Const operands (they may trap).
      if (expr.op === "div" || expr.op === "rem") return false;
      return isSideEffectFree(expr.left) && isSideEffectFree(expr.right);
    case "UnOp":
      return isSideEffectFree(expr.operand);
    case "IfExpr":
      return (
        isSideEffectFree(expr.cond) &&
        isSideEffectFree(expr.then) &&
        isSideEffectFree(expr.else_)
      );
    case "CallExpr":
    case "Load":
    case "Alloc":
    case "BlockExpr":
      return false;
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `dce: unhandled expr ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}

// ---- Local usage / densification ----

function collectUsedLocals(stmts: IRStmt[]): Set<number> {
  const used = new Set<number>();
  walkStmts(stmts, (expr) => {
    if (expr.kind === "LocalGet") used.add(expr.index);
  });
  return used;
}

function allWritesSideEffectFree(stmts: IRStmt[], index: number): boolean {
  let ok = true;
  walkStmtNodes(stmts, (stmt) => {
    if (stmt.kind === "LocalSet" && stmt.index === index) {
      if (!isSideEffectFree(stmt.value)) ok = false;
    }
  });
  return ok;
}

function stripLocalSets(stmts: IRStmt[], removable: Set<number>): IRStmt[] {
  const out: IRStmt[] = [];
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "LocalSet":
        if (removable.has(stmt.index)) {
          // Value is side-effect-free (precondition); drop the set entirely.
          break;
        }
        out.push({
          ...stmt,
          value: stripLocalSetsInExpr(stmt.value, removable),
        });
        break;
      case "Block":
        out.push({ ...stmt, body: stripLocalSets(stmt.body, removable) });
        break;
      case "Loop":
        out.push({ ...stmt, body: stripLocalSets(stmt.body, removable) });
        break;
      case "IfStmt":
        out.push({
          ...stmt,
          cond: stripLocalSetsInExpr(stmt.cond, removable),
          then: stripLocalSets(stmt.then, removable),
          else_: stmt.else_
            ? stripLocalSets(stmt.else_, removable)
            : undefined,
        });
        break;
      case "BrIf":
        out.push({
          ...stmt,
          cond: stripLocalSetsInExpr(stmt.cond, removable),
        });
        break;
      case "Store":
        out.push({
          ...stmt,
          addr: stripLocalSetsInExpr(stmt.addr, removable),
          value: stripLocalSetsInExpr(stmt.value, removable),
        });
        break;
      case "CallStmt":
        out.push({
          ...stmt,
          args: stmt.args.map((a) => stripLocalSetsInExpr(a, removable)),
        });
        break;
      case "Drop":
        out.push({
          ...stmt,
          value: stripLocalSetsInExpr(stmt.value, removable),
        });
        break;
      case "Return":
        out.push(
          stmt.value
            ? {
                ...stmt,
                value: stripLocalSetsInExpr(stmt.value, removable),
              }
            : stmt,
        );
        break;
      default:
        out.push(stmt);
    }
  }
  return out;
}

/** Strip removable LocalSets nested inside BlockExpr bodies within expressions. */
function stripLocalSetsInExpr(
  expr: IRExpr,
  removable: Set<number>,
): IRExpr {
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      return expr;
    case "BinOp":
      return {
        ...expr,
        left: stripLocalSetsInExpr(expr.left, removable),
        right: stripLocalSetsInExpr(expr.right, removable),
      };
    case "UnOp":
      return {
        ...expr,
        operand: stripLocalSetsInExpr(expr.operand, removable),
      };
    case "CallExpr":
      return {
        ...expr,
        args: expr.args.map((a) => stripLocalSetsInExpr(a, removable)),
      };
    case "Load":
      return { ...expr, addr: stripLocalSetsInExpr(expr.addr, removable) };
    case "IfExpr":
      return {
        ...expr,
        cond: stripLocalSetsInExpr(expr.cond, removable),
        then: stripLocalSetsInExpr(expr.then, removable),
        else_: stripLocalSetsInExpr(expr.else_, removable),
      };
    case "Alloc":
      return { ...expr, size: stripLocalSetsInExpr(expr.size, removable) };
    case "BlockExpr":
      return {
        ...expr,
        body: stripLocalSets(expr.body, removable),
        result: stripLocalSetsInExpr(expr.result, removable),
      };
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `dce: unhandled expr ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}

function densifyLocals(
  paramCount: number,
  locals: WasmType[],
  removable: Set<number>,
): { newLocals: WasmType[]; indexMap: Map<number, number> } {
  const indexMap = new Map<number, number>();
  // Params keep their indices.
  for (let i = 0; i < paramCount; i++) {
    indexMap.set(i, i);
  }
  const newLocals: WasmType[] = [];
  for (let i = 0; i < locals.length; i++) {
    const oldIndex = paramCount + i;
    if (removable.has(oldIndex)) continue;
    const newIndex = paramCount + newLocals.length;
    indexMap.set(oldIndex, newIndex);
    newLocals.push(locals[i]!);
  }
  return { newLocals, indexMap };
}

function remapIndices(stmts: IRStmt[], indexMap: Map<number, number>): IRStmt[] {
  return stmts.map((stmt) => remapStmt(stmt, indexMap));
}

function remapStmt(stmt: IRStmt, indexMap: Map<number, number>): IRStmt {
  switch (stmt.kind) {
    case "Block":
      return { ...stmt, body: remapIndices(stmt.body, indexMap) };
    case "Loop":
      return { ...stmt, body: remapIndices(stmt.body, indexMap) };
    case "IfStmt":
      return {
        ...stmt,
        cond: remapExpr(stmt.cond, indexMap),
        then: remapIndices(stmt.then, indexMap),
        else_: stmt.else_ ? remapIndices(stmt.else_, indexMap) : undefined,
      };
    case "Br":
      return stmt;
    case "BrIf":
      return { ...stmt, cond: remapExpr(stmt.cond, indexMap) };
    case "LocalSet":
      return {
        kind: "LocalSet",
        index: mapIndex(stmt.index, indexMap),
        value: remapExpr(stmt.value, indexMap),
      };
    case "Store":
      return {
        ...stmt,
        addr: remapExpr(stmt.addr, indexMap),
        value: remapExpr(stmt.value, indexMap),
      };
    case "CallStmt":
      return { ...stmt, args: stmt.args.map((a) => remapExpr(a, indexMap)) };
    case "Drop":
      return { ...stmt, value: remapExpr(stmt.value, indexMap) };
    case "Return":
      return stmt.value
        ? { ...stmt, value: remapExpr(stmt.value, indexMap) }
        : stmt;
    case "Unreachable":
      return stmt;
    default: {
      const _exhaustive: never = stmt;
      throw new Error(`dce: unhandled stmt ${(_exhaustive as IRStmt).kind}`);
    }
  }
}

function remapExpr(expr: IRExpr, indexMap: Map<number, number>): IRExpr {
  switch (expr.kind) {
    case "Const":
    case "DataPtr":
      return expr;
    case "LocalGet":
      return { ...expr, index: mapIndex(expr.index, indexMap) };
    case "BinOp":
      return {
        ...expr,
        left: remapExpr(expr.left, indexMap),
        right: remapExpr(expr.right, indexMap),
      };
    case "UnOp":
      return { ...expr, operand: remapExpr(expr.operand, indexMap) };
    case "CallExpr":
      return { ...expr, args: expr.args.map((a) => remapExpr(a, indexMap)) };
    case "Load":
      return { ...expr, addr: remapExpr(expr.addr, indexMap) };
    case "IfExpr":
      return {
        ...expr,
        cond: remapExpr(expr.cond, indexMap),
        then: remapExpr(expr.then, indexMap),
        else_: remapExpr(expr.else_, indexMap),
      };
    case "Alloc":
      return { ...expr, size: remapExpr(expr.size, indexMap) };
    case "BlockExpr":
      return {
        ...expr,
        body: remapIndices(expr.body, indexMap),
        result: remapExpr(expr.result, indexMap),
      };
    default: {
      const _exhaustive: never = expr;
      throw new Error(`dce: unhandled expr ${(_exhaustive as IRExpr).kind}`);
    }
  }
}

function mapIndex(index: number, indexMap: Map<number, number>): number {
  const mapped = indexMap.get(index);
  if (mapped === undefined) {
    throw new Error(`dce: local index ${index} missing from densification map`);
  }
  return mapped;
}

// ---- Walkers ----

function walkStmts(stmts: IRStmt[], visit: (expr: IRExpr) => void): void {
  for (const stmt of stmts) walkStmtExprs(stmt, visit);
}

function walkStmtExprs(stmt: IRStmt, visit: (expr: IRExpr) => void): void {
  switch (stmt.kind) {
    case "Block":
    case "Loop":
      walkStmts(stmt.body, visit);
      break;
    case "IfStmt":
      walkExpr(stmt.cond, visit);
      walkStmts(stmt.then, visit);
      if (stmt.else_) walkStmts(stmt.else_, visit);
      break;
    case "Br":
      break;
    case "BrIf":
      walkExpr(stmt.cond, visit);
      break;
    case "LocalSet":
      walkExpr(stmt.value, visit);
      break;
    case "Store":
      walkExpr(stmt.addr, visit);
      walkExpr(stmt.value, visit);
      break;
    case "CallStmt":
      for (const a of stmt.args) walkExpr(a, visit);
      break;
    case "Drop":
      walkExpr(stmt.value, visit);
      break;
    case "Return":
      if (stmt.value) walkExpr(stmt.value, visit);
      break;
    case "Unreachable":
      break;
    default: {
      const _exhaustive: never = stmt;
      throw new Error(`dce: unhandled stmt ${(_exhaustive as IRStmt).kind}`);
    }
  }
}

function walkExpr(expr: IRExpr, visit: (expr: IRExpr) => void): void {
  visit(expr);
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      break;
    case "BinOp":
      walkExpr(expr.left, visit);
      walkExpr(expr.right, visit);
      break;
    case "UnOp":
      walkExpr(expr.operand, visit);
      break;
    case "CallExpr":
      for (const a of expr.args) walkExpr(a, visit);
      break;
    case "Load":
      walkExpr(expr.addr, visit);
      break;
    case "IfExpr":
      walkExpr(expr.cond, visit);
      walkExpr(expr.then, visit);
      walkExpr(expr.else_, visit);
      break;
    case "Alloc":
      walkExpr(expr.size, visit);
      break;
    case "BlockExpr":
      // Critical: descend into body so temp locals used by array/index
      // lowering are collected and densified correctly.
      walkStmts(expr.body, visit);
      walkExpr(expr.result, visit);
      break;
    default: {
      const _exhaustive: never = expr;
      throw new Error(`dce: unhandled expr ${(_exhaustive as IRExpr).kind}`);
    }
  }
}

function walkStmtNodes(stmts: IRStmt[], visit: (stmt: IRStmt) => void): void {
  for (const stmt of stmts) {
    visit(stmt);
    switch (stmt.kind) {
      case "Block":
      case "Loop":
        walkStmtNodes(stmt.body, visit);
        break;
      case "IfStmt":
        walkStmtNodes(stmt.then, visit);
        if (stmt.else_) walkStmtNodes(stmt.else_, visit);
        // Also walk BlockExpr bodies nested in the condition.
        walkExprStmtNodes(stmt.cond, visit);
        break;
      case "LocalSet":
        walkExprStmtNodes(stmt.value, visit);
        break;
      case "Store":
        walkExprStmtNodes(stmt.addr, visit);
        walkExprStmtNodes(stmt.value, visit);
        break;
      case "CallStmt":
        for (const a of stmt.args) walkExprStmtNodes(a, visit);
        break;
      case "Drop":
        walkExprStmtNodes(stmt.value, visit);
        break;
      case "Return":
        if (stmt.value) walkExprStmtNodes(stmt.value, visit);
        break;
      case "BrIf":
        walkExprStmtNodes(stmt.cond, visit);
        break;
      default:
        break;
    }
  }
}

/** Walk statement nodes nested inside BlockExpr expressions. */
function walkExprStmtNodes(
  expr: IRExpr,
  visit: (stmt: IRStmt) => void,
): void {
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      break;
    case "BinOp":
      walkExprStmtNodes(expr.left, visit);
      walkExprStmtNodes(expr.right, visit);
      break;
    case "UnOp":
      walkExprStmtNodes(expr.operand, visit);
      break;
    case "CallExpr":
      for (const a of expr.args) walkExprStmtNodes(a, visit);
      break;
    case "Load":
      walkExprStmtNodes(expr.addr, visit);
      break;
    case "IfExpr":
      walkExprStmtNodes(expr.cond, visit);
      walkExprStmtNodes(expr.then, visit);
      walkExprStmtNodes(expr.else_, visit);
      break;
    case "Alloc":
      walkExprStmtNodes(expr.size, visit);
      break;
    case "BlockExpr":
      walkStmtNodes(expr.body, visit);
      walkExprStmtNodes(expr.result, visit);
      break;
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `dce: unhandled expr ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}
