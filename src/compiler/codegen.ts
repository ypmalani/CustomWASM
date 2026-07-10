import type {
  IRBinOp,
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "./ir.js";

/**
 * IR → WAT codegen.
 * Expressions emit post-order onto the stack machine; statements map 1:1
 * onto WASM structured control flow (block/loop/if/br/br_if/return).
 * Locals are referenced by the dense numeric indices already assigned in IR.
 */

export function emit(ir: IRModule): string {
  const lines: string[] = [];
  lines.push("(module");

  // Build funcIndex → name for call emission.
  const funcNames = ir.functions.map((f) => f.name);

  for (const fn of ir.functions) {
    emitFunction(fn, lines, 1, funcNames);
  }

  lines.push(")");
  return lines.join("\n") + "\n";
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function emitFunction(
  fn: IRFunction,
  lines: string[],
  level: number,
  funcNames: string[],
): void {
  const exportPart = fn.exported ? ` (export "${fn.name}")` : "";
  const paramPart = fn.params.map((t) => ` (param ${t})`).join("");
  const resultPart = fn.result ? ` (result ${fn.result})` : "";
  const localsPart = fn.locals.map((t) => ` (local ${t})`).join("");

  lines.push(
    `${indent(level)}(func $${fn.name}${exportPart}${paramPart}${resultPart}${localsPart}`,
  );

  for (const stmt of fn.body) {
    emitStmt(stmt, lines, level + 1, funcNames);
  }

  lines.push(`${indent(level)})`);
}

function emitStmt(
  stmt: IRStmt,
  lines: string[],
  level: number,
  funcNames: string[],
): void {
  switch (stmt.kind) {
    case "Block": {
      lines.push(`${indent(level)}block`);
      for (const s of stmt.body) {
        emitStmt(s, lines, level + 1, funcNames);
      }
      lines.push(`${indent(level)}end`);
      break;
    }
    case "Loop": {
      lines.push(`${indent(level)}loop`);
      for (const s of stmt.body) {
        emitStmt(s, lines, level + 1, funcNames);
      }
      lines.push(`${indent(level)}end`);
      break;
    }
    case "IfStmt": {
      emitExpr(stmt.cond, lines, level, funcNames);
      lines.push(`${indent(level)}if`);
      for (const s of stmt.then) {
        emitStmt(s, lines, level + 1, funcNames);
      }
      if (stmt.else_) {
        lines.push(`${indent(level)}else`);
        for (const s of stmt.else_) {
          emitStmt(s, lines, level + 1, funcNames);
        }
      }
      lines.push(`${indent(level)}end`);
      break;
    }
    case "Br": {
      lines.push(`${indent(level)}br ${stmt.target}`);
      break;
    }
    case "BrIf": {
      emitExpr(stmt.cond, lines, level, funcNames);
      lines.push(`${indent(level)}br_if ${stmt.target}`);
      break;
    }
    case "LocalSet": {
      emitExpr(stmt.value, lines, level, funcNames);
      lines.push(`${indent(level)}local.set ${stmt.index}`);
      break;
    }
    case "Store": {
      throw new Error("codegen: Store is not supported (Phase 7)");
    }
    case "CallStmt": {
      for (const arg of stmt.args) {
        emitExpr(arg, lines, level, funcNames);
      }
      const name = funcNames[stmt.funcIndex];
      if (name === undefined) {
        throw new Error(`codegen: invalid funcIndex ${stmt.funcIndex}`);
      }
      lines.push(`${indent(level)}call $${name}`);
      break;
    }
    case "Drop": {
      emitExpr(stmt.value, lines, level, funcNames);
      lines.push(`${indent(level)}drop`);
      break;
    }
    case "Return": {
      if (stmt.value) {
        emitExpr(stmt.value, lines, level, funcNames);
      }
      lines.push(`${indent(level)}return`);
      break;
    }
    case "Unreachable": {
      lines.push(`${indent(level)}unreachable`);
      break;
    }
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `codegen: unhandled statement ${(_exhaustive as IRStmt).kind}`,
      );
    }
  }
}

function emitExpr(
  expr: IRExpr,
  lines: string[],
  level: number,
  funcNames: string[],
): void {
  switch (expr.kind) {
    case "Const": {
      lines.push(`${indent(level)}${expr.type}.const ${formatConst(expr.type, expr.value)}`);
      break;
    }
    case "LocalGet": {
      lines.push(`${indent(level)}local.get ${expr.index}`);
      break;
    }
    case "BinOp": {
      emitExpr(expr.left, lines, level, funcNames);
      emitExpr(expr.right, lines, level, funcNames);
      lines.push(`${indent(level)}${binOpInstr(expr.type, expr.op)}`);
      break;
    }
    case "UnOp": {
      if (expr.op === "eqz") {
        emitExpr(expr.operand, lines, level, funcNames);
        lines.push(`${indent(level)}i32.eqz`);
      } else {
        // neg: i32 → 0 - x; f64 → f64.neg
        if (expr.type === "i32") {
          lines.push(`${indent(level)}i32.const 0`);
          emitExpr(expr.operand, lines, level, funcNames);
          lines.push(`${indent(level)}i32.sub`);
        } else {
          emitExpr(expr.operand, lines, level, funcNames);
          lines.push(`${indent(level)}f64.neg`);
        }
      }
      break;
    }
    case "CallExpr": {
      for (const arg of expr.args) {
        emitExpr(arg, lines, level, funcNames);
      }
      const name = funcNames[expr.funcIndex];
      if (name === undefined) {
        throw new Error(`codegen: invalid funcIndex ${expr.funcIndex}`);
      }
      lines.push(`${indent(level)}call $${name}`);
      break;
    }
    case "IfExpr": {
      emitExpr(expr.cond, lines, level, funcNames);
      lines.push(`${indent(level)}if (result ${expr.type})`);
      emitExpr(expr.then, lines, level + 1, funcNames);
      lines.push(`${indent(level)}else`);
      emitExpr(expr.else_, lines, level + 1, funcNames);
      lines.push(`${indent(level)}end`);
      break;
    }
    case "Load": {
      throw new Error("codegen: Load is not supported (Phase 7)");
    }
    case "DataPtr": {
      throw new Error("codegen: DataPtr is not supported (Phase 7)");
    }
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `codegen: unhandled expression ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}

function formatConst(type: WasmType, value: number): string {
  if (type === "i32") {
    return String(value);
  }
  // f64: ensure a decimal representation
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function binOpInstr(type: WasmType, op: IRBinOp): string {
  const prefix = type;
  switch (op) {
    case "add":
      return `${prefix}.add`;
    case "sub":
      return `${prefix}.sub`;
    case "mul":
      return `${prefix}.mul`;
    case "div":
      return type === "i32" ? "i32.div_s" : "f64.div";
    case "rem":
      return "i32.rem_s";
    case "eq":
      return `${prefix}.eq`;
    case "ne":
      return `${prefix}.ne`;
    case "lt":
      return type === "i32" ? "i32.lt_s" : "f64.lt";
    case "le":
      return type === "i32" ? "i32.le_s" : "f64.le";
    case "gt":
      return type === "i32" ? "i32.gt_s" : "f64.gt";
    case "ge":
      return type === "i32" ? "i32.ge_s" : "f64.ge";
    case "and":
      return "i32.and";
    case "or":
      return "i32.or";
    default: {
      const _exhaustive: never = op;
      throw new Error(`codegen: unhandled binop '${_exhaustive}'`);
    }
  }
}
