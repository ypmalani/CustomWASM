import type { Program } from "./ast.js";
import { emit } from "./codegen.js";
import type { Diagnostic } from "./diagnostics.js";
import { lex } from "./lexer.js";
import { parse } from "./parser.js";
import type { Token } from "./token.js";

export interface CompileResult {
  tokens: Token[];
  ast: Program;
  diagnostics: Diagnostic[];
  wat: string | null;
}

/**
 * Orchestrates lex → parse → emit.
 * Returns every intermediate artifact for the playground / tests.
 * Codegen is skipped when parse diagnostics are present.
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

  let wat: string | null = null;
  if (diagnostics.length === 0) {
    try {
      wat = emit(program);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      diagnostics.push({
        message,
        span: { start: 0, end: 0, line: 1, col: 1 },
        severity: "error",
      });
    }
  }

  return { tokens, ast: program, diagnostics, wat };
}
