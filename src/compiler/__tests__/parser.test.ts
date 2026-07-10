import { lex } from "../lexer.js";
import { parse } from "../parser.js";
import type { Expr, Stmt } from "../ast.js";

function parseSource(source: string) {
  return parse(lex(source));
}

describe("parser", () => {
  it("parses the exit-criteria program", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    );
    expect(diagnostics).toEqual([]);
    expect(program.functions).toHaveLength(1);
    const main = program.functions[0]!;
    expect(main.name).toBe("main");
    expect(main.returnType).toMatchObject({
      kind: "PrimitiveType",
      name: "i32",
    });
    expect(main.body.statements).toHaveLength(2);

    const letStmt = main.body.statements[0] as Extract<Stmt, { kind: "Let" }>;
    expect(letStmt.kind).toBe("Let");
    expect(letStmt.name).toBe("x");
    // 2 + (3 * 4) — multiplication binds tighter
    expect(letStmt.init).toMatchObject({
      kind: "Binary",
      op: "+",
      left: { kind: "IntLiteral", value: 2 },
      right: {
        kind: "Binary",
        op: "*",
        left: { kind: "IntLiteral", value: 3 },
        right: { kind: "IntLiteral", value: 4 },
      },
    });

    const ret = main.body.statements[1] as Extract<Stmt, { kind: "Return" }>;
    expect(ret.kind).toBe("Return");
    expect(ret.value).toMatchObject({ kind: "Identifier", name: "x" });
  });

  it("parses left-associative addition", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { return 1 - 2 - 3; }",
    );
    expect(diagnostics).toEqual([]);
    const ret = program.functions[0]!.body.statements[0] as Extract<
      Stmt,
      { kind: "Return" }
    >;
    const expr = ret.value as Expr;
    // (1 - 2) - 3
    expect(expr).toMatchObject({
      kind: "Binary",
      op: "-",
      left: {
        kind: "Binary",
        op: "-",
        left: { kind: "IntLiteral", value: 1 },
        right: { kind: "IntLiteral", value: 2 },
      },
      right: { kind: "IntLiteral", value: 3 },
    });
  });

  it("respects parentheses over precedence", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { return (2 + 3) * 4; }",
    );
    expect(diagnostics).toEqual([]);
    const ret = program.functions[0]!.body.statements[0] as Extract<
      Stmt,
      { kind: "Return" }
    >;
    expect(ret.value).toMatchObject({
      kind: "Binary",
      op: "*",
      left: {
        kind: "Binary",
        op: "+",
        left: { kind: "IntLiteral", value: 2 },
        right: { kind: "IntLiteral", value: 3 },
      },
      right: { kind: "IntLiteral", value: 4 },
    });
  });

  it("parses unary minus", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { return -5; }",
    );
    expect(diagnostics).toEqual([]);
    const ret = program.functions[0]!.body.statements[0] as Extract<
      Stmt,
      { kind: "Return" }
    >;
    expect(ret.value).toMatchObject({
      kind: "Unary",
      op: "-",
      operand: { kind: "IntLiteral", value: 5 },
    });
  });

  it("parses optional type annotation on let", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { let x: i32 = 1; return x; }",
    );
    expect(diagnostics).toEqual([]);
    const letStmt = program.functions[0]!.body.statements[0] as Extract<
      Stmt,
      { kind: "Let" }
    >;
    expect(letStmt.declaredType).toMatchObject({
      kind: "PrimitiveType",
      name: "i32",
    });
  });

  it("reports diagnostic for missing semicolon", () => {
    const { diagnostics } = parseSource(
      "fn main() -> i32 { let x = 1 return x; }",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.message).toMatch(/expected ';'/);
  });

  it("reports diagnostic for unbalanced parens", () => {
    const { diagnostics } = parseSource(
      "fn main() -> i32 { return (1 + 2; }",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => /expected '\)'/.test(d.message))).toBe(true);
  });

  it("recovers and continues after a bad statement", () => {
    const { program, diagnostics } = parseSource(
      "fn main() -> i32 { let = 1; return 2; }",
    );
    expect(diagnostics.length).toBeGreaterThan(0);
    // Should still have parsed the function and the return
    expect(program.functions).toHaveLength(1);
    const stmts = program.functions[0]!.body.statements;
    const hasReturn = stmts.some((s) => s.kind === "Return");
    expect(hasReturn).toBe(true);
  });

  it("attaches spans to AST nodes", () => {
    const { program } = parseSource("fn main() -> i32 { return 42; }");
    const ret = program.functions[0]!.body.statements[0]!;
    expect(ret.span.line).toBe(1);
    expect(ret.span.start).toBeGreaterThanOrEqual(0);
    expect(ret.span.end).toBeGreaterThan(ret.span.start);
  });
});
