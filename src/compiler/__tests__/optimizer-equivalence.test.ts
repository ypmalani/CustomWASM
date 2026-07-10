import { emit } from "../codegen.js";
import type { IRModule } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import { countInstructions, optimize } from "../optimizer/index.js";
import { parse } from "../parser.js";
import { check } from "../typechecker.js";
import { compileAndInstantiate, validateWat } from "./wabt-helper.js";

function lowerSource(source: string): IRModule {
  const tokens = lex(source);
  const { program, diagnostics: parseDiags } = parse(tokens);
  expect(parseDiags).toEqual([]);
  const { typedProgram, diagnostics } = check(program);
  expect(diagnostics).toEqual([]);
  expect(typedProgram).not.toBeNull();
  return lower(typedProgram!);
}

async function runIr(ir: IRModule): Promise<number> {
  const wat = emit(ir);
  await validateWat(wat);
  const exports = await compileAndInstantiate(wat);
  return exports.main();
}

/** Full Phase 1 / 3 corpus: [source, expected]. */
const CORPUS: Array<[string, number]> = [
  // Phase 1
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
  // Phase 3 — control flow
  [
    `fn main() -> i32 {
      if (1 < 2) { return 10; } else { return 20; }
    }`,
    10,
  ],
  [
    `fn main() -> i32 {
      if (5 < 2) { return 10; } else { return 20; }
    }`,
    20,
  ],
  [
    `fn main() -> i32 {
      let x = 2;
      if (x == 1) { return 100; }
      else if (x == 2) { return 200; }
      else { return 300; }
    }`,
    200,
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
    6,
  ],
  [
    `fn main() -> i32 {
      let a = 0;
      if (1 == 1 && 2 == 2) { a = a + 1; }
      if (0 == 1 && 2 == 2) { a = a + 10; }
      if (1 == 1 && 2 == 3) { a = a + 100; }
      return a;
    }`,
    1,
  ],
  [
    `fn main() -> i32 {
      let a = 0;
      if (0 == 1 || 2 == 2) { a = a + 1; }
      if (1 == 1 || 2 == 3) { a = a + 1; }
      if (0 == 1 || 2 == 3) { a = a + 10; }
      return a;
    }`,
    2,
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
  [
    `fn double(x: i32) -> i32 { return x * 2; }
     fn main() -> i32 { return double(21); }`,
    42,
  ],
  [
    `fn add(a: i32, b: i32) -> i32 { return a + b; }
     fn main() -> i32 { return add(10, 32); }`,
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
      let x = 1;
      let y = 0;
      { let x = 10; y = x; }
      return y + x;
    }`,
    11,
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
];

const BENCHMARKS: string[] = [
  "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
  `fn main() -> i32 {
    if (1 == 1 && 2 != 3 || !(false)) { return 1; } else { return 0; }
  }`,
  `fn main() -> i32 {
    if (true) { return 10 + 20 + 30; } else { return 999; }
  }`,
  `fn main() -> i32 {
    let dead = 1 + 2 + 3;
    let x = 5 * 5;
    return x;
  }`,
];

describe("optimizer equivalence — unoptimized vs optimized", () => {
  it("identical runtime results across the full Phase 1/3 corpus", async () => {
    for (const [src, expected] of CORPUS) {
      const ir = lowerSource(src);
      const opt = optimize(ir);
      const unoptResult = await runIr(ir);
      const optResult = await runIr(opt);
      expect(unoptResult, `unopt: ${src}`).toBe(expected);
      expect(optResult, `opt: ${src}`).toBe(expected);
      expect(optResult, `opt===unopt: ${src}`).toBe(unoptResult);
    }
  });

  it("instruction count decreases on benchmark inputs", () => {
    for (const src of BENCHMARKS) {
      const ir = lowerSource(src);
      const opt = optimize(ir);
      expect(
        countInstructions(opt),
        `should shrink: ${src}`,
      ).toBeLessThan(countInstructions(ir));
    }
  });

  it("pipeline compile() exposes both wat and optimizedWat with same result", async () => {
    const { compile } = await import("../pipeline.js");
    const src = "fn main() -> i32 { let x = 2 + 3 * 4; return x; }";
    const result = compile(src);
    expect(result.diagnostics).toEqual([]);
    expect(result.wat).not.toBeNull();
    expect(result.optimizedWat).not.toBeNull();
    expect(result.ir).not.toBeNull();
    expect(result.optimizedIr).not.toBeNull();

    await validateWat(result.wat!);
    await validateWat(result.optimizedWat!);

    const unopt = await compileAndInstantiate(result.wat!);
    const opt = await compileAndInstantiate(result.optimizedWat!);
    expect(unopt.main()).toBe(14);
    expect(opt.main()).toBe(14);
  });
});
