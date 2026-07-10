import { compile } from "../pipeline.js";
import { compileAndInstantiate, validateWat } from "./wabt-helper.js";

async function runMain(source: string): Promise<number> {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.wat).not.toBeNull();
  await validateWat(result.wat!);
  const exports = await compileAndInstantiate(result.wat!);
  return exports.main();
}

describe("codegen phase 3 (control flow, functions, scoping)", () => {
  // ---- if/else ----
  it("if/else: then branch", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          if (1 < 2) {
            return 10;
          } else {
            return 20;
          }
        }
      `),
    ).toBe(10);
  });

  it("if/else: else branch", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          if (5 < 2) {
            return 10;
          } else {
            return 20;
          }
        }
      `),
    ).toBe(20);
  });

  it("if/else: else-if chain", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let x = 2;
          if (x == 1) {
            return 100;
          } else if (x == 2) {
            return 200;
          } else {
            return 300;
          }
        }
      `),
    ).toBe(200);
  });

  // ---- while ----
  it("while: accumulator loop", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let i = 0;
          let sum = 0;
          while (i < 5) {
            sum = sum + i;
            i = i + 1;
          }
          return sum;
        }
      `),
    ).toBe(10); // 0+1+2+3+4
  });

  // ---- comparisons & logical operators ----
  it("comparisons: == != < <= > >=", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let a = 0;
          if (3 == 3) { a = a + 1; }
          if (3 != 4) { a = a + 1; }
          if (2 < 3) { a = a + 1; }
          if (3 <= 3) { a = a + 1; }
          if (4 > 3) { a = a + 1; }
          if (4 >= 4) { a = a + 1; }
          return a;
        }
      `),
    ).toBe(6);
  });

  it("logical and: short-circuit &&", async () => {
    // 1 && 1 → true (1); 0 && 1 → false (0); 1 && 0 → false (0)
    expect(
      await runMain(`
        fn main() -> i32 {
          let a = 0;
          if (1 == 1 && 2 == 2) { a = a + 1; }
          if (0 == 1 && 2 == 2) { a = a + 10; }
          if (1 == 1 && 2 == 3) { a = a + 100; }
          return a;
        }
      `),
    ).toBe(1);
  });

  it("logical or: short-circuit ||", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let a = 0;
          if (0 == 1 || 2 == 2) { a = a + 1; }
          if (1 == 1 || 2 == 3) { a = a + 1; }
          if (0 == 1 || 2 == 3) { a = a + 10; }
          return a;
        }
      `),
    ).toBe(2);
  });

  it("logical not: !", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          if (!(1 == 2)) {
            return 42;
          } else {
            return 0;
          }
        }
      `),
    ).toBe(42);
  });

  it("bool literals", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          if (true) {
            if (false) {
              return 0;
            } else {
              return 7;
            }
          } else {
            return 0;
          }
        }
      `),
    ).toBe(7);
  });

  // ---- function call ----
  it("function call: main calls a helper", async () => {
    expect(
      await runMain(`
        fn double(x: i32) -> i32 {
          return x * 2;
        }
        fn main() -> i32 {
          return double(21);
        }
      `),
    ).toBe(42);
  });

  it("function call: multi-arg", async () => {
    expect(
      await runMain(`
        fn add(a: i32, b: i32) -> i32 {
          return a + b;
        }
        fn main() -> i32 {
          return add(10, 32);
        }
      `),
    ).toBe(42);
  });

  // ---- recursion ----
  it("recursion: fib(n)", async () => {
    expect(
      await runMain(`
        fn fib(n: i32) -> i32 {
          if (n <= 1) {
            return n;
          } else {
            return fib(n - 1) + fib(n - 2);
          }
        }
        fn main() -> i32 {
          return fib(10);
        }
      `),
    ).toBe(55);
  });

  // ---- shadowing ----
  it("shadowing: inner let shadows outer; outer restored after block", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let x = 1;
          {
            let x = 100;
            x = x + 1;
          }
          return x;
        }
      `),
    ).toBe(1);
  });

  it("shadowing: assignment resolves to nearest binding", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
          let x = 1;
          let y = 0;
          {
            let x = 10;
            y = x;
          }
          return y + x;
        }
      `),
    ).toBe(11); // y=10 (inner x), + outer x=1
  });

  // ---- Exit criteria ----
  it("exit criteria: recursive fib(10) → 55", async () => {
    expect(
      await runMain(`
        fn fib(n: i32) -> i32 {
          if (n <= 1) {
            return n;
          } else {
            return fib(n - 1) + fib(n - 2);
          }
        }
        fn main() -> i32 {
          return fib(10);
        }
      `),
    ).toBe(55);
  });

  it("exit criteria: iterative fib(10) → 55", async () => {
    expect(
      await runMain(`
        fn main() -> i32 {
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
        }
      `),
    ).toBe(55);
  });

  // ---- WAT validation sweep ----
  it("all Phase 3 sample programs pass wat2wasm validation", async () => {
    const programs = [
      `fn main() -> i32 { if (true) { return 1; } else { return 0; } }`,
      `fn main() -> i32 { let i = 0; while (i < 3) { i = i + 1; } return i; }`,
      `fn id(x: i32) -> i32 { return x; } fn main() -> i32 { return id(5); }`,
      `fn fib(n: i32) -> i32 { if (n <= 1) { return n; } else { return fib(n - 1) + fib(n - 2); } } fn main() -> i32 { return fib(5); }`,
      `fn main() -> i32 { let x = 1; { let x = 2; } return x; }`,
      `fn main() -> i32 { return 1 == 1 && 2 != 3 || !(false); }`,
    ];
    for (const src of programs) {
      const { wat, diagnostics } = compile(src);
      expect(diagnostics, `diagnostics for: ${src}`).toEqual([]);
      await expect(
        validateWat(wat!),
        `validate: ${src}`,
      ).resolves.toBeUndefined();
    }
  });

  // ---- Phase 1 regression ----
  it("Phase 1 regression: arithmetic programs still pass", async () => {
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
    ];
    for (const [src, expected] of cases) {
      expect(await runMain(src), `regression: ${src}`).toBe(expected);
    }
  });
});
