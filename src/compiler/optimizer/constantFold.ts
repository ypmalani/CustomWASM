import type {
  IRBinOp,
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "../ir.js";
import type { Pass } from "./fixpoint.js";

const INT_MIN = -2147483648; // -2^31

/**
 * Bottom-up constant folding. Evaluates Const-operand expression subtrees at
 * compile time with exact WASM semantics. Never folds trap-producing ops:
 * i32 div/rem by zero, and i32 INT_MIN / -1.
 */
export const constantFold: Pass = {
  name: "constantFold",
  run(ir: IRModule): IRModule {
    return {
      ...ir,
      functions: ir.functions.map(foldFunction),
    };
  },
};

function foldFunction(fn: IRFunction): IRFunction {
  return {
    ...fn,
    body: fn.body.map(foldStmt),
  };
}

function foldStmt(stmt: IRStmt): IRStmt {
  switch (stmt.kind) {
    case "Block":
      return { ...stmt, body: stmt.body.map(foldStmt) };
    case "Loop":
      return { ...stmt, body: stmt.body.map(foldStmt) };
    case "IfStmt":
      return {
        kind: "IfStmt",
        cond: foldExpr(stmt.cond),
        then: stmt.then.map(foldStmt),
        else_: stmt.else_?.map(foldStmt),
      };
    case "Br":
      return stmt;
    case "BrIf":
      return { ...stmt, cond: foldExpr(stmt.cond) };
    case "LocalSet":
      return { ...stmt, value: foldExpr(stmt.value) };
    case "Store":
      return {
        ...stmt,
        addr: foldExpr(stmt.addr),
        value: foldExpr(stmt.value),
      };
    case "CallStmt":
      return { ...stmt, args: stmt.args.map(foldExpr) };
    case "Drop":
      return { ...stmt, value: foldExpr(stmt.value) };
    case "Return":
      return stmt.value
        ? { ...stmt, value: foldExpr(stmt.value) }
        : stmt;
    case "Unreachable":
      return stmt;
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `constantFold: unhandled stmt ${(_exhaustive as IRStmt).kind}`,
      );
    }
  }
}

function foldExpr(expr: IRExpr): IRExpr {
  switch (expr.kind) {
    case "Const":
    case "LocalGet":
    case "DataPtr":
      return expr;
    case "BinOp": {
      const left = foldExpr(expr.left);
      const right = foldExpr(expr.right);
      if (left.kind === "Const" && right.kind === "Const") {
        const folded = tryFoldBinOp(expr.type, expr.op, left.value, right.value);
        if (folded !== null) {
          return { kind: "Const", type: expr.type, value: folded };
        }
      }
      return { ...expr, left, right };
    }
    case "UnOp": {
      const operand = foldExpr(expr.operand);
      if (operand.kind === "Const") {
        return {
          kind: "Const",
          type: expr.type,
          value: foldUnOp(expr.op, expr.type, operand.value),
        };
      }
      return { ...expr, operand };
    }
    case "CallExpr":
      return { ...expr, args: expr.args.map(foldExpr) };
    case "Load":
      return { ...expr, addr: foldExpr(expr.addr) };
    case "IfExpr": {
      const cond = foldExpr(expr.cond);
      const then = foldExpr(expr.then);
      const else_ = foldExpr(expr.else_);
      if (cond.kind === "Const") {
        // Non-zero → then arm; zero → else arm (WASM if semantics).
        return cond.value !== 0 ? then : else_;
      }
      return { kind: "IfExpr", type: expr.type, cond, then, else_ };
    }
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `constantFold: unhandled expr ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}

/**
 * Attempt to fold a binary op. Returns null when folding would change trap
 * semantics (div/rem by zero, INT_MIN / -1 for i32.div_s).
 */
function tryFoldBinOp(
  type: WasmType,
  op: IRBinOp,
  left: number,
  right: number,
): number | null {
  if (type === "i32") {
    return foldI32BinOp(op, left | 0, right | 0);
  }
  return foldF64BinOp(op, left, right);
}

function foldI32BinOp(op: IRBinOp, left: number, right: number): number | null {
  switch (op) {
    case "add":
      return (left + right) | 0;
    case "sub":
      return (left - right) | 0;
    case "mul":
      return Math.imul(left, right);
    case "div":
      // Trap: divide by zero, or INT_MIN / -1 (signed overflow).
      if (right === 0) return null;
      if (left === INT_MIN && right === -1) return null;
      return (left / right) | 0; // trunc toward zero, then wrap
    case "rem":
      // Trap: rem by zero. INT_MIN % -1 is defined as 0 in WASM (no trap).
      if (right === 0) return null;
      return (left % right) | 0;
    case "eq":
      return left === right ? 1 : 0;
    case "ne":
      return left !== right ? 1 : 0;
    case "lt":
      return left < right ? 1 : 0;
    case "le":
      return left <= right ? 1 : 0;
    case "gt":
      return left > right ? 1 : 0;
    case "ge":
      return left >= right ? 1 : 0;
    case "and":
      return left & right;
    case "or":
      return left | right;
    default: {
      const _exhaustive: never = op;
      throw new Error(`constantFold: unhandled i32 binop '${_exhaustive}'`);
    }
  }
}

function foldF64BinOp(op: IRBinOp, left: number, right: number): number {
  switch (op) {
    case "add":
      return left + right;
    case "sub":
      return left - right;
    case "mul":
      return left * right;
    case "div":
      // f64 division never traps (yields ±Infinity / NaN).
      return left / right;
    case "rem":
      // rem is i32-only in our language; should not appear on f64.
      throw new Error("constantFold: rem is not defined for f64");
    case "eq":
      return left === right ? 1 : 0;
    case "ne":
      return left !== right ? 1 : 0;
    case "lt":
      return left < right ? 1 : 0;
    case "le":
      return left <= right ? 1 : 0;
    case "gt":
      return left > right ? 1 : 0;
    case "ge":
      return left >= right ? 1 : 0;
    case "and":
    case "or":
      throw new Error(`constantFold: ${op} is not defined for f64`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`constantFold: unhandled f64 binop '${_exhaustive}'`);
    }
  }
}

function foldUnOp(
  op: "eqz" | "neg",
  type: WasmType,
  value: number,
): number {
  if (op === "eqz") {
    return value === 0 ? 1 : 0;
  }
  // neg
  if (type === "i32") {
    return (0 - (value | 0)) | 0;
  }
  return -value;
}
