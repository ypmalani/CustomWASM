import type { Block, Expr, FunctionDecl, Program, Stmt } from "./ast.js";

/**
 * Direct AST → WAT codegen for the Phase 3 subset:
 *   - fn declarations with parameters and optional return type
 *   - let bindings, assignment, lexical scoping with shadowing
 *   - if/else, while (structured control flow)
 *   - arithmetic, comparisons, logical ops (&&/|| short-circuit), unary -/!
 *   - bool/int literals, identifiers, function calls (incl. recursion)
 *   - main is exported; all values are i32 (bool lowers to i32)
 *
 * Out-of-subset nodes (f64/string/array/index) throw an internal error.
 */

interface FuncSig {
  arity: number;
  hasResult: boolean;
}

type ScopeStack = Array<Map<string, number>>;

interface EmitCtx {
  signatures: Map<string, FuncSig>;
  /** Pre-assigned dense local index for each Let statement node. */
  letIndices: Map<Stmt, number>;
  /** Lexical scope stack: each Block pushes a frame. */
  scopes: ScopeStack;
}

export function emit(program: Program): string {
  const signatures = buildSignatures(program);
  const lines: string[] = [];
  lines.push("(module");

  for (const fn of program.functions) {
    emitFunction(fn, lines, 1, signatures);
  }

  lines.push(")");
  return lines.join("\n") + "\n";
}

function buildSignatures(program: Program): Map<string, FuncSig> {
  const signatures = new Map<string, FuncSig>();
  for (const fn of program.functions) {
    signatures.set(fn.name, {
      arity: fn.params.length,
      hasResult: fn.returnType !== undefined,
    });
  }
  return signatures;
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function emitFunction(
  fn: FunctionDecl,
  lines: string[],
  level: number,
  signatures: Map<string, FuncSig>,
): void {
  // Params occupy indices 0..n-1; lets continue from n.
  const letIndices = new Map<Stmt, number>();
  let nextIndex = fn.params.length;
  nextIndex = allocateLetIndices(fn.body, letIndices, nextIndex);
  const numLets = nextIndex - fn.params.length;

  const isMain = fn.name === "main";
  const exportPart = isMain ? ` (export "main")` : "";
  // WASM header order: name, export, params, result, locals
  const paramPart = fn.params.map(() => " (param i32)").join("");
  const resultPart = fn.returnType ? " (result i32)" : "";
  const localsPart = Array.from({ length: numLets }, () => " (local i32)").join(
    "",
  );

  lines.push(
    `${indent(level)}(func $${fn.name}${exportPart}${paramPart}${resultPart}${localsPart}`,
  );

  // Seed the outermost scope with parameters.
  const scopes: ScopeStack = [new Map()];
  for (let i = 0; i < fn.params.length; i++) {
    scopes[0]!.set(fn.params[i]!.name, i);
  }

  const ctx: EmitCtx = { signatures, letIndices, scopes };
  emitBlock(fn.body, lines, level + 1, ctx);

  // Result functions need a trailing unreachable so WASM validation accepts
  // the function end when the last statement is an if/while whose arms
  // return (control never falls through, but the type checker still wants
  // an i32 or an unreachable end). Definite-return analysis is Phase 4.
  if (fn.returnType) {
    lines.push(`${indent(level + 1)}unreachable`);
  }

  lines.push(`${indent(level)})`);
}

/** Assign a unique dense local index to every Let node (depth-first). */
function allocateLetIndices(
  block: Block,
  letIndices: Map<Stmt, number>,
  nextIndex: number,
): number {
  for (const stmt of block.statements) {
    nextIndex = allocateLetIndicesStmt(stmt, letIndices, nextIndex);
  }
  return nextIndex;
}

function allocateLetIndicesStmt(
  stmt: Stmt,
  letIndices: Map<Stmt, number>,
  nextIndex: number,
): number {
  switch (stmt.kind) {
    case "Let":
      letIndices.set(stmt, nextIndex);
      return nextIndex + 1;
    case "Block":
      return allocateLetIndices(stmt, letIndices, nextIndex);
    case "If": {
      nextIndex = allocateLetIndices(stmt.then, letIndices, nextIndex);
      if (stmt.else_) {
        if (stmt.else_.kind === "Block") {
          nextIndex = allocateLetIndices(stmt.else_, letIndices, nextIndex);
        } else {
          nextIndex = allocateLetIndicesStmt(stmt.else_, letIndices, nextIndex);
        }
      }
      return nextIndex;
    }
    case "While":
      return allocateLetIndices(stmt.body, letIndices, nextIndex);
    case "Assign":
    case "Return":
    case "ExprStmt":
      return nextIndex;
    default: {
      const _exhaustive: never = stmt;
      void _exhaustive;
      return nextIndex;
    }
  }
}

function resolveLocal(name: string, scopes: ScopeStack): number {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const idx = scopes[i]!.get(name);
    if (idx !== undefined) return idx;
  }
  throw new Error(`codegen: unbound identifier '${name}'`);
}

function emitBlock(
  block: Block,
  lines: string[],
  level: number,
  ctx: EmitCtx,
): void {
  ctx.scopes.push(new Map());
  for (const stmt of block.statements) {
    emitStmt(stmt, lines, level, ctx);
  }
  ctx.scopes.pop();
}

function emitStmt(
  stmt: Stmt,
  lines: string[],
  level: number,
  ctx: EmitCtx,
): void {
  switch (stmt.kind) {
    case "Let": {
      emitExpr(stmt.init, lines, level, ctx);
      const idx = ctx.letIndices.get(stmt);
      if (idx === undefined) {
        throw new Error(`codegen: missing local index for let '${stmt.name}'`);
      }
      lines.push(`${indent(level)}local.set ${idx}`);
      ctx.scopes[ctx.scopes.length - 1]!.set(stmt.name, idx);
      break;
    }
    case "Assign": {
      if (stmt.target.kind !== "Identifier") {
        throw new Error("codegen: indexed assignment is not supported");
      }
      emitExpr(stmt.value, lines, level, ctx);
      const idx = resolveLocal(stmt.target.name, ctx.scopes);
      lines.push(`${indent(level)}local.set ${idx}`);
      break;
    }
    case "If": {
      emitExpr(stmt.cond, lines, level, ctx);
      lines.push(`${indent(level)}if`);
      emitBlock(stmt.then, lines, level + 1, ctx);
      if (stmt.else_) {
        lines.push(`${indent(level)}else`);
        if (stmt.else_.kind === "Block") {
          emitBlock(stmt.else_, lines, level + 1, ctx);
        } else {
          // Chained else-if: emit as a nested if statement inside the else arm.
          emitStmt(stmt.else_, lines, level + 1, ctx);
        }
      }
      lines.push(`${indent(level)}end`);
      break;
    }
    case "While": {
      // Canonical lowering:
      //   block
      //     loop
      //       <cond>  i32.eqz  br_if 1   ;; exit when !cond
      //       <body>
      //       br 0                      ;; continue
      //     end
      //   end
      lines.push(`${indent(level)}block`);
      lines.push(`${indent(level + 1)}loop`);
      emitExpr(stmt.cond, lines, level + 2, ctx);
      lines.push(`${indent(level + 2)}i32.eqz`);
      lines.push(`${indent(level + 2)}br_if 1`);
      emitBlock(stmt.body, lines, level + 2, ctx);
      lines.push(`${indent(level + 2)}br 0`);
      lines.push(`${indent(level + 1)}end`);
      lines.push(`${indent(level)}end`);
      break;
    }
    case "Return": {
      if (stmt.value) {
        emitExpr(stmt.value, lines, level, ctx);
      }
      lines.push(`${indent(level)}return`);
      break;
    }
    case "ExprStmt": {
      emitExpr(stmt.expr, lines, level, ctx);
      // Drop the result only when the expression yields a value.
      if (exprYieldsValue(stmt.expr, ctx.signatures)) {
        lines.push(`${indent(level)}drop`);
      }
      break;
    }
    case "Block":
      emitBlock(stmt, lines, level, ctx);
      break;
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `codegen: unhandled statement ${(_exhaustive as Stmt).kind}`,
      );
    }
  }
}

function exprYieldsValue(
  expr: Expr,
  signatures: Map<string, FuncSig>,
): boolean {
  if (expr.kind === "Call") {
    const sig = signatures.get(expr.callee);
    if (sig === undefined) {
      throw new Error(`codegen: unknown function '${expr.callee}'`);
    }
    return sig.hasResult;
  }
  return true;
}

function emitExpr(
  expr: Expr,
  lines: string[],
  level: number,
  ctx: EmitCtx,
): void {
  switch (expr.kind) {
    case "IntLiteral":
      lines.push(`${indent(level)}i32.const ${expr.value}`);
      break;
    case "BoolLiteral":
      lines.push(`${indent(level)}i32.const ${expr.value ? 1 : 0}`);
      break;
    case "Identifier": {
      const idx = resolveLocal(expr.name, ctx.scopes);
      lines.push(`${indent(level)}local.get ${idx}`);
      break;
    }
    case "Unary": {
      if (expr.op === "-") {
        lines.push(`${indent(level)}i32.const 0`);
        emitExpr(expr.operand, lines, level, ctx);
        lines.push(`${indent(level)}i32.sub`);
      } else {
        // !
        emitExpr(expr.operand, lines, level, ctx);
        lines.push(`${indent(level)}i32.eqz`);
      }
      break;
    }
    case "Binary": {
      if (expr.op === "&&") {
        // Short-circuit: <a> if (result i32) <b> else i32.const 0 end
        emitExpr(expr.left, lines, level, ctx);
        lines.push(`${indent(level)}if (result i32)`);
        emitExpr(expr.right, lines, level + 1, ctx);
        lines.push(`${indent(level)}else`);
        lines.push(`${indent(level + 1)}i32.const 0`);
        lines.push(`${indent(level)}end`);
        break;
      }
      if (expr.op === "||") {
        // Short-circuit: <a> if (result i32) i32.const 1 else <b> end
        emitExpr(expr.left, lines, level, ctx);
        lines.push(`${indent(level)}if (result i32)`);
        lines.push(`${indent(level + 1)}i32.const 1`);
        lines.push(`${indent(level)}else`);
        emitExpr(expr.right, lines, level + 1, ctx);
        lines.push(`${indent(level)}end`);
        break;
      }

      emitExpr(expr.left, lines, level, ctx);
      emitExpr(expr.right, lines, level, ctx);
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
        case "==":
          lines.push(`${indent(level)}i32.eq`);
          break;
        case "!=":
          lines.push(`${indent(level)}i32.ne`);
          break;
        case "<":
          lines.push(`${indent(level)}i32.lt_s`);
          break;
        case "<=":
          lines.push(`${indent(level)}i32.le_s`);
          break;
        case ">":
          lines.push(`${indent(level)}i32.gt_s`);
          break;
        case ">=":
          lines.push(`${indent(level)}i32.ge_s`);
          break;
        default: {
          const _exhaustive: never = expr.op;
          throw new Error(`codegen: unhandled operator '${_exhaustive}'`);
        }
      }
      break;
    }
    case "Call": {
      const sig = ctx.signatures.get(expr.callee);
      if (sig === undefined) {
        throw new Error(`codegen: unknown function '${expr.callee}'`);
      }
      if (expr.args.length !== sig.arity) {
        throw new Error(
          `codegen: call to '${expr.callee}' expected ${sig.arity} args, got ${expr.args.length}`,
        );
      }
      for (const arg of expr.args) {
        emitExpr(arg, lines, level, ctx);
      }
      lines.push(`${indent(level)}call $${expr.callee}`);
      break;
    }
    case "FloatLiteral":
      throw new Error("codegen: float literals are not supported");
    case "StringLiteral":
      throw new Error("codegen: string literals are not supported");
    case "ArrayLiteral":
      throw new Error("codegen: array literals are not supported");
    case "Index":
      throw new Error("codegen: indexing is not supported");
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `codegen: unhandled expression ${(_exhaustive as Expr).kind}`,
      );
    }
  }
}
