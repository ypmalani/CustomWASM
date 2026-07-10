import type { Program } from "./ast.js";
import { emit } from "./codegen.js";
import type { Diagnostic } from "./diagnostics.js";
import type { IRModule } from "./ir.js";
import { lex } from "./lexer.js";
import { lower } from "./lower.js";
import { parse } from "./parser.js";
import type { Token } from "./token.js";
import type { TypedProgram } from "./typed-ast.js";
import { check } from "./typechecker.js";

export interface CompileResult {
  tokens: Token[];
  ast: Program;
  typedAst: TypedProgram | null;
  diagnostics: Diagnostic[];
  ir: IRModule | null;
  wat: string | null;
}

/**
 * Orchestrates lex → parse → typecheck → lower → emit.
 * Returns every intermediate artifact for the playground / tests.
 * Later stages are skipped when prior-stage diagnostics are present.
 */
export function compile(source: string): CompileResult {
  const tokens = lex(source);
  const { program, diagnostics } = parse(tokens);

  // Also surface lexer Error tokens as diagnostics
  for (const tok of tokens) {
    if (tok.type === "Error") {
      diagnostics.push({
        message: tok.value,
        span: tok.span,
        severity: "error",
      });
    }
  }

  let typedAst: TypedProgram | null = null;
  if (diagnostics.length === 0) {
    const checked = check(program);
    diagnostics.push(...checked.diagnostics);
    typedAst = checked.typedProgram;
  }

  let ir: IRModule | null = null;
  let wat: string | null = null;
  if (diagnostics.length === 0 && typedAst !== null) {
    try {
      ir = lower(typedAst);
      wat = emit(ir);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        message,
        span: { start: 0, end: 0, line: 1, col: 1 },
        severity: "error",
      });
      ir = null;
      wat = null;
    }
  }

  return { tokens, ast: program, typedAst, diagnostics, ir, wat };
}
