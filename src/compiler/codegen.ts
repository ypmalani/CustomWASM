import type { Block, Expr, FunctionDecl, Program, Stmt } from "./ast.js";

/**
 * Direct AST → WAT codegen for the Phase 1 subset:
 *   - fn main() -> i32 (no params)
 *   - let bindings (i32)
 *   - return
 *   - arithmetic: + - * / % and unary -
 *   - int literals, identifiers, parenthesized expressions
 *
 * Out-of-subset nodes throw an internal error (compiler bug / Phase 3+ feature).
 */
export function emit(program: Program): string {
  const lines: string[] = [];
  lines.push("(module");

  for (const fn of program.functions) {
    emitFunction(fn, lines, 1);
  }

  lines.push(")");
  return lines.join("\n") + "\n";
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function emitFunction(fn: FunctionDecl, lines: string[], level: number): void {
  if (fn.params.length > 0) {
    throw new Error(
      `Phase 1 codegen: function parameters are not supported (found in '${fn.name}')`,
    );
  }

  // Pre-pass: collect let-bound locals in declaration order → dense i32 indices
  const locals = new Map<string, number>();
  collectLocals(fn.body, locals);

  const isMain = fn.name === "main";
  const exportPart = isMain ? ` (export "main")` : "";
  const resultPart = fn.returnType ? " (result i32)" : "";

  const localDecls: string[] = [];
  for (let i = 0; i < locals.size; i++) {
    localDecls.push("(local i32)");
  }
  const localsPart = localDecls.length > 0 ? " " + localDecls.join(" ") : "";

  lines.push(
    `${indent(level)}(func $${fn.name}${exportPart}${resultPart}${localsPart}`,
  );

  emitBlock(fn.body, lines, level + 1, locals);

  lines.push(`${indent(level)})`);
}

function collectLocals(block: Block, locals: Map<string, number>): void {
  for (const stmt of block.statements) {
    collectLocalsStmt(stmt, locals);
  }
}

function collectLocalsStmt(stmt: Stmt, locals: Map<string, number>): void {
  switch (stmt.kind) {
    case "Let":
      if (!locals.has(stmt.name)) {
        locals.set(stmt.name, locals.size);
      }
      break;
    case "Block":
      collectLocals(stmt, locals);
      break;
    case "If":
      collectLocals(stmt.then, locals);
      if (stmt.else_) {
        if (stmt.else_.kind === "Block") {
          collectLocals(stmt.else_, locals);
        } else {
          collectLocalsStmt(stmt.else_, locals);
        }
      }
      break;
    case "While":
      collectLocals(stmt.body, locals);
      break;
    case "Assign":
    case "Return":
    case "ExprStmt":
      break;
    default: {
      const _exhaustive: never = stmt;
      void _exhaustive;
      break;
    }
  }
}

function emitBlock(
  block: Block,
  lines: string[],
  level: number,
  locals: Map<string, number>,
): void {
  for (const stmt of block.statements) {
    emitStmt(stmt, lines, level, locals);
  }
}

function emitStmt(
  stmt: Stmt,
  lines: string[],
  level: number,
  locals: Map<string, number>,
): void {
  switch (stmt.kind) {
    case "Let": {
      emitExpr(stmt.init, lines, level, locals);
      const idx = locals.get(stmt.name);
      if (idx === undefined) {
        throw new Error(`Phase 1 codegen: unbound local '${stmt.name}'`);
      }
      lines.push(`${indent(level)}local.set ${idx}`);
      break;
    }
    case "Return": {
      if (stmt.value) {
        emitExpr(stmt.value, lines, level, locals);
      }
      lines.push(`${indent(level)}return`);
      break;
    }
    case "ExprStmt": {
      emitExpr(stmt.expr, lines, level, locals);
      lines.push(`${indent(level)}drop`);
      break;
    }
    case "Block":
      emitBlock(stmt, lines, level, locals);
      break;
    case "Assign":
      throw new Error("Phase 1 codegen: assignment is not supported");
    case "If":
      throw new Error("Phase 1 codegen: if/else is not supported");
    case "While":
      throw new Error("Phase 1 codegen: while is not supported");
    default: {
      const _exhaustive: never = stmt;
      throw new Error(`Phase 1 codegen: unhandled statement ${(_exhaustive as Stmt).kind}`);
    }
  }
}

function emitExpr(
  expr: Expr,
  lines: string[],
  level: number,
  locals: Map<string, number>,
): void {
  switch (expr.kind) {
    case "IntLiteral":
      lines.push(`${indent(level)}i32.const ${expr.value}`);
      break;
    case "Identifier": {
      const idx = locals.get(expr.name);
      if (idx === undefined) {
        throw new Error(`Phase 1 codegen: unbound identifier '${expr.name}'`);
      }
      lines.push(`${indent(level)}local.get ${idx}`);
      break;
    }
    case "Unary": {
      if (expr.op === "-") {
        lines.push(`${indent(level)}i32.const 0`);
        emitExpr(expr.operand, lines, level, locals);
        lines.push(`${indent(level)}i32.sub`);
      } else {
        throw new Error("Phase 1 codegen: logical not (!) is not supported");
      }
      break;
    }
    case "Binary": {
      emitExpr(expr.left, lines, level, locals);
      emitExpr(expr.right, lines, level, locals);
      switch (expr.op) {
        case "+":
          lines.push(`${indent(level)}i32.add`);
          break;
        case "-":
          lines.push(`${indent(level)}i32.sub`);
          break;
        case "*":
          lines.push(`${indent(level)}i32.mul`);
          break;
        case "/":
          lines.push(`${indent(level)}i32.div_s`);
          break;
        case "%":
          lines.push(`${indent(level)}i32.rem_s`);
          break;
        default:
          throw new Error(
            `Phase 1 codegen: operator '${expr.op}' is not supported`,
          );
      }
      break;
    }
    case "FloatLiteral":
      throw new Error("Phase 1 codegen: float literals are not supported");
    case "BoolLiteral":
      throw new Error("Phase 1 codegen: bool literals are not supported");
    case "StringLiteral":
      throw new Error("Phase 1 codegen: string literals are not supported");
    case "ArrayLiteral":
      throw new Error("Phase 1 codegen: array literals are not supported");
    case "Call":
      throw new Error("Phase 1 codegen: function calls are not supported");
    case "Index":
      throw new Error("Phase 1 codegen: indexing is not supported");
    default: {
      const _exhaustive: never = expr;
      throw new Error(`Phase 1 codegen: unhandled expression ${(_exhaustive as Expr).kind}`);
    }
  }
}
