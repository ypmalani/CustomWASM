import { lex } from "../lexer.js";
import { parse } from "../parser.js";
import { compile } from "../pipeline.js";
import { check } from "../typechecker.js";
import { compileAndInstantiate, validateWat } from "./wabt-helper.js";

function typecheck(source: string) {
  const tokens = lex(source);
  const { program, diagnostics: parseDiags } = parse(tokens);
  expect(parseDiags).toEqual([]);
  return check(program);
}

function messagesOf(source: string): string[] {
  return typecheck(source).diagnostics.map((d) => d.message);
}

function expectExactDiag(
  source: string,
  expected: Array<{ message: string; snippet: string }>,
): void {
  const { diagnostics, typedProgram } = typecheck(source);
  expect(typedProgram).toBeNull();
  expect(diagnostics).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    const d = diagnostics[i]!;
    const e = expected[i]!;
    expect(d.severity).toBe("error");
    expect(d.message).toBe(e.message);
    expect(source.slice(d.span.start, d.span.end)).toBe(e.snippet);
  }
}

async function runMain(source: string): Promise<number> {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.typedAst).not.toBeNull();
  expect(result.wat).not.toBeNull();
  await validateWat(result.wat!);
  const exports = await compileAndInstantiate(result.wat!);
  return exports.main();
}

describe("typechecker — ill-typed corpus", () => {
  it("coercion violation: i32 + f64", () => {
    const src = "fn main() -> i32 { return 1 + 1.5; }";
    expectExactDiag(src, [
      {
        message:
          "operator '+' requires operands of the same numeric type, found 'i32' and 'f64'",
        snippet: "1 + 1.5",
      },
    ]);
  });

  it("non-bool condition: if", () => {
    const src = "fn main() -> i32 { if (1) { return 0; } else { return 1; } }";
    expectExactDiag(src, [
      {
        message: "condition must be 'bool', found 'i32'",
        snippet: "1",
      },
    ]);
  });

  it("non-bool condition: while", () => {
    const src = "fn main() -> i32 { while (0) { return 1; } return 0; }";
    expectExactDiag(src, [
      {
        message: "condition must be 'bool', found 'i32'",
        snippet: "0",
      },
    ]);
  });

  it("non-bool condition: unary !", () => {
    const src = "fn main() -> i32 { if (!1) { return 0; } else { return 1; } }";
    expectExactDiag(src, [
      {
        message: "condition must be 'bool', found 'i32'",
        snippet: "1",
      },
    ]);
  });

  it("non-bool condition: && operands", () => {
    const src =
      "fn main() -> i32 { if (1 && true) { return 0; } else { return 1; } }";
    expectExactDiag(src, [
      {
        message: "condition must be 'bool', found 'i32'",
        snippet: "1",
      },
    ]);
  });

  it("arity mismatch", () => {
    const src = `
      fn add(a: i32, b: i32) -> i32 { return a + b; }
      fn main() -> i32 { return add(1); }
    `;
    const { diagnostics, typedProgram } = typecheck(src);
    expect(typedProgram).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toBe(
      "function 'add' expects 2 arguments, found 1",
    );
    expect(src.slice(diagnostics[0]!.span.start, diagnostics[0]!.span.end)).toBe(
      "add(1)",
    );
  });

  it("argument type mismatch", () => {
    const src = `
      fn add(a: i32, b: i32) -> i32 { return a + b; }
      fn main() -> i32 { return add(1, true); }
    `;
    const { diagnostics, typedProgram } = typecheck(src);
    expect(typedProgram).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe("error");
    expect(diagnostics[0]!.message).toBe(
      "argument 2 of 'add' expects 'i32', found 'bool'",
    );
    expect(src.slice(diagnostics[0]!.span.start, diagnostics[0]!.span.end)).toBe(
      "true",
    );
  });

  it("return type mismatch", () => {
    const src = "fn main() -> i32 { return true; }";
    expectExactDiag(src, [
      {
        message: "function 'main' must return 'i32', found 'bool'",
        snippet: "return true;",
      },
    ]);
  });

  it("missing return on some path", () => {
    const src = "fn f() -> i32 { if (true) { return 1; } } fn main() -> i32 { return f(); }";
    const { diagnostics, typedProgram } = typecheck(src);
    expect(typedProgram).toBeNull();
    expect(diagnostics.some((d) => d.message === "function 'f' must return 'i32' on all paths")).toBe(
      true,
    );
    const d = diagnostics.find(
      (x) => x.message === "function 'f' must return 'i32' on all paths",
    )!;
    expect(d.severity).toBe("error");
    expect(src.slice(d.span.start, d.span.end)).toContain("fn f()");
  });

  it("use-before-declaration / undefined variable", () => {
    const src = "fn main() -> i32 { return x; }";
    expectExactDiag(src, [
      {
        message: "undefined variable 'x'",
        snippet: "x",
      },
    ]);
  });

  it("redeclaration in same scope", () => {
    const src = "fn main() -> i32 { let x = 1; let x = 2; return x; }";
    expectExactDiag(src, [
      {
        message: "variable 'x' is already declared in this scope",
        snippet: "let x = 2;",
      },
    ]);
  });

  it("assignment type mismatch", () => {
    const src = "fn main() -> i32 { let x = 1; x = true; return x; }";
    expectExactDiag(src, [
      {
        message: "cannot assign 'bool' to variable 'x' of type 'i32'",
        snippet: "x = true;",
      },
    ]);
  });

  it("let declared-type mismatch", () => {
    const src = "fn main() -> i32 { let x: i32 = true; return 0; }";
    expectExactDiag(src, [
      {
        message: "declared type 'i32' does not match initializer type 'bool'",
        snippet: "let x: i32 = true;",
      },
    ]);
  });

  it("collects multiple diagnostics (not fail-fast)", () => {
    const src = `
      fn main() -> i32 {
        let a = 1 + 1.5;
        if (0) { return 1; }
        return true;
      }
    `;
    const msgs = messagesOf(src);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs).toContain(
      "operator '+' requires operands of the same numeric type, found 'i32' and 'f64'",
    );
    expect(msgs).toContain("condition must be 'bool', found 'i32'");
    expect(msgs).toContain("function 'main' must return 'i32', found 'bool'");
  });
});

describe("typechecker — well-typed pass-through", () => {
  const wellTyped: string[] = [
    // Phase 1
    "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    "fn main() -> i32 { return 42; }",
    "fn main() -> i32 { return 10 + 5; }",
    "fn main() -> i32 { return 10 - 3; }",
    "fn main() -> i32 { return 6 * 7; }",
    "fn main() -> i32 { return 20 / 4; }",
    "fn main() -> i32 { return 17 % 5; }",
    "fn main() -> i32 { return -7; }",
    "fn main() -> i32 { return (2 + 3) * 4; }",
    "fn main() -> i32 { return 10 - 3 - 2; }",
    `fn main() -> i32 {
      let a = 2;
      let b = 3;
      let c = a * b + 1;
      return c;
    }`,
    "fn main() -> i32 { let x: i32 = 99; return x; }",
    // Phase 3
    `fn main() -> i32 {
      if (1 < 2) { return 10; } else { return 20; }
    }`,
    `fn main() -> i32 {
      let i = 0;
      let sum = 0;
      while (i < 5) {
        sum = sum + i;
        i = i + 1;
      }
      return sum;
    }`,
    `fn main() -> i32 {
      let a = 0;
      if (3 == 3) { a = a + 1; }
      if (3 != 4) { a = a + 1; }
      if (2 < 3) { a = a + 1; }
      if (3 <= 3) { a = a + 1; }
      if (4 > 3) { a = a + 1; }
      if (4 >= 4) { a = a + 1; }
      return a;
    }`,
    `fn main() -> i32 {
      let a = 0;
      if (1 == 1 && 2 == 2) { a = a + 1; }
      if (0 == 1 && 2 == 2) { a = a + 10; }
      if (1 == 1 && 2 == 3) { a = a + 100; }
      return a;
    }`,
    `fn main() -> i32 {
      let a = 0;
      if (0 == 1 || 2 == 2) { a = a + 1; }
      if (1 == 1 || 2 == 3) { a = a + 1; }
      if (0 == 1 || 2 == 3) { a = a + 10; }
      return a;
    }`,
    `fn main() -> i32 {
      if (!(1 == 2)) { return 42; } else { return 0; }
    }`,
    `fn main() -> i32 {
      if (true) {
        if (false) { return 0; } else { return 7; }
      } else { return 0; }
    }`,
    `fn double(x: i32) -> i32 { return x * 2; }
     fn main() -> i32 { return double(21); }`,
    `fn add(a: i32, b: i32) -> i32 { return a + b; }
     fn main() -> i32 { return add(10, 32); }`,
    `fn fib(n: i32) -> i32 {
       if (n <= 1) { return n; }
       else { return fib(n - 1) + fib(n - 2); }
     }
     fn main() -> i32 { return fib(10); }`,
    `fn main() -> i32 {
       let x = 1;
       { let x = 100; x = x + 1; }
       return x;
     }`,
    `fn main() -> i32 {
       let x = 1;
       let y = 0;
       { let x = 10; y = x; }
       return y + x;
     }`,
    `fn main() -> i32 {
       let n = 10;
       let a = 0;
       let b = 1;
       let i = 0;
       while (i < n) {
         let next = a + b;
         a = b;
         b = next;
         i = i + 1;
       }
       return a;
     }`,
    `fn main() -> i32 { if (true) { return 1; } else { return 0; } }`,
    `fn main() -> i32 { let i = 0; while (i < 3) { i = i + 1; } return i; }`,
    `fn id(x: i32) -> i32 { return x; } fn main() -> i32 { return id(5); }`,
    `fn main() -> i32 { if (1 == 1 && 2 != 3 || !(false)) { return 1; } else { return 0; } }`,
  ];

  it("every Phase 1-3 well-typed program type-checks with zero diagnostics", () => {
    for (const src of wellTyped) {
      const { diagnostics, typedProgram } = typecheck(src);
      expect(diagnostics, `diags for: ${src}`).toEqual([]);
      expect(typedProgram, `typedAst for: ${src}`).not.toBeNull();
    }
  });
});

describe("typechecker — compile/execute unchanged", () => {
  const cases: Array<[string, number]> = [
    ["fn main() -> i32 { let x = 2 + 3 * 4; return x; }", 14],
    ["fn main() -> i32 { return 42; }", 42],
    ["fn main() -> i32 { return 10 + 5; }", 15],
    ["fn main() -> i32 { return 10 - 3; }", 7],
    ["fn main() -> i32 { return 6 * 7; }", 42],
    ["fn main() -> i32 { return 20 / 4; }", 5],
    ["fn main() -> i32 { return 17 % 5; }", 2],
    ["fn main() -> i32 { return -7; }", -7],
    ["fn main() -> i32 { return (2 + 3) * 4; }", 20],
    ["fn main() -> i32 { return 10 - 3 - 2; }", 5],
    [
      `fn main() -> i32 {
        let a = 2;
        let b = 3;
        let c = a * b + 1;
        return c;
      }`,
      7,
    ],
    ["fn main() -> i32 { let x: i32 = 99; return x; }", 99],
    [
      `fn main() -> i32 {
        if (1 < 2) { return 10; } else { return 20; }
      }`,
      10,
    ],
    [
      `fn main() -> i32 {
        let i = 0;
        let sum = 0;
        while (i < 5) {
          sum = sum + i;
          i = i + 1;
        }
        return sum;
      }`,
      10,
    ],
    [
      `fn double(x: i32) -> i32 { return x * 2; }
       fn main() -> i32 { return double(21); }`,
      42,
    ],
    [
      `fn fib(n: i32) -> i32 {
         if (n <= 1) { return n; }
         else { return fib(n - 1) + fib(n - 2); }
       }
       fn main() -> i32 { return fib(10); }`,
      55,
    ],
    [
      `fn main() -> i32 {
         let x = 1;
         { let x = 100; x = x + 1; }
         return x;
       }`,
      1,
    ],
    [
      `fn main() -> i32 {
         let n = 10;
         let a = 0;
         let b = 1;
         let i = 0;
         while (i < n) {
           let next = a + b;
           a = b;
           b = next;
           i = i + 1;
         }
         return a;
       }`,
      55,
    ],
    [
      `fn main() -> i32 {
         if (!(1 == 2)) { return 42; } else { return 0; }
       }`,
      42,
    ],
    [
      `fn main() -> i32 {
         if (true) {
           if (false) { return 0; } else { return 7; }
         } else { return 0; }
       }`,
      7,
    ],
  ];

  it("well-typed programs still compile, validate, and execute unchanged", async () => {
    for (const [src, expected] of cases) {
      expect(await runMain(src), `runtime: ${src}`).toBe(expected);
    }
  });

  it("ill-typed programs do not produce WAT", () => {
    const result = compile("fn main() -> i32 { return true; }");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.wat).toBeNull();
    expect(result.typedAst).toBeNull();
  });
});
