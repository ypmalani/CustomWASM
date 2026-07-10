import { compile } from "../pipeline.js";
import { trace } from "../stepper.js";
import type { IRModule } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import { parse } from "../parser.js";
import { check } from "../typechecker.js";
import {
  compileAndInstantiate,
  compileAndInstantiateWithPrints,
  validateWat,
} from "./wabt-helper.js";

function lowerSource(source: string): IRModule {
  const tokens = lex(source);
  const { program, diagnostics: parseDiags } = parse(tokens);
  expect(parseDiags).toEqual([]);
  const { typedProgram, diagnostics } = check(program);
  expect(diagnostics).toEqual([]);
  expect(typedProgram).not.toBeNull();
  return lower(typedProgram!);
}

describe("stepper sequence — arithmetic", () => {
  it("traces 2 + 3 * 4 with correct stack push/pop", () => {
    const ir = lowerSource(
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    );
    const { steps, returnValue, trapped } = trace(ir);
    expect(trapped).toBe(false);
    expect(returnValue).toBe(14);

    // First steps: push 2, push 3, push 4, mul → [2,12], add → [14], local.set
    expect(steps[0]!.instruction).toBe("i32.const 2");
    expect(steps[0]!.stack.map((v) => v.bits)).toEqual([2]);

    expect(steps[1]!.instruction).toBe("i32.const 3");
    expect(steps[1]!.stack.map((v) => v.bits)).toEqual([2, 3]);

    expect(steps[2]!.instruction).toBe("i32.const 4");
    expect(steps[2]!.stack.map((v) => v.bits)).toEqual([2, 3, 4]);

    expect(steps[3]!.instruction).toBe("i32.mul");
    expect(steps[3]!.stack.map((v) => v.bits)).toEqual([2, 12]);

    expect(steps[4]!.instruction).toBe("i32.add");
    expect(steps[4]!.stack.map((v) => v.bits)).toEqual([14]);

    expect(steps[5]!.instruction).toBe("local.set 0");
    expect(steps[5]!.stack).toEqual([]);
    expect(steps[5]!.locals[0]!.bits).toBe(14);

    // Last steps: local.get 0, return
    const last = steps[steps.length - 1]!;
    expect(last.instruction).toBe("return");
    expect(last.stack).toEqual([]);

    const beforeReturn = steps[steps.length - 2]!;
    expect(beforeReturn.instruction).toBe("local.get 0");
    expect(beforeReturn.stack.map((v) => v.bits)).toEqual([14]);
  });
});

describe("stepper sequence — if/else", () => {
  it("takes then branch and leaves correct stack", () => {
    const ir = lowerSource(`fn main() -> i32 {
      if (1 < 2) { return 10; } else { return 20; }
    }`);
    const { steps, returnValue, trapped } = trace(ir);
    expect(trapped).toBe(false);
    expect(returnValue).toBe(10);

    expect(steps[0]!.instruction).toBe("i32.const 1");
    expect(steps[1]!.instruction).toBe("i32.const 2");
    expect(steps[2]!.instruction).toBe("i32.lt_s");
    expect(steps[2]!.stack.map((v) => v.bits)).toEqual([1]);

    expect(steps[3]!.instruction).toBe("if");
    expect(steps[3]!.stack).toEqual([]);

    // Then arm: const 10, return — never executes else const 20
    const instrs = steps.map((s) => s.instruction);
    expect(instrs).toContain("i32.const 10");
    expect(instrs).not.toContain("i32.const 20");

    const last = steps[steps.length - 1]!;
    expect(last.instruction).toBe("return");
  });

  it("takes else branch", () => {
    const ir = lowerSource(`fn main() -> i32 {
      if (5 < 2) { return 10; } else { return 20; }
    }`);
    const { returnValue, steps, trapped } = trace(ir);
    expect(trapped).toBe(false);
    expect(returnValue).toBe(20);
    const instrs = steps.map((s) => s.instruction);
    expect(instrs).toContain("i32.const 20");
    expect(instrs).not.toContain("i32.const 10");
  });
});

describe("stepper sequence — while", () => {
  it("accumulates sum 0..4 → 10", () => {
    const ir = lowerSource(`fn main() -> i32 {
      let i = 0;
      let sum = 0;
      while (i < 5) {
        sum = sum + i;
        i = i + 1;
      }
      return sum;
    }`);
    const { steps, returnValue, trapped } = trace(ir);
    expect(trapped).toBe(false);
    expect(returnValue).toBe(10);

    // Init: const 0, local.set 0, const 0, local.set 1
    expect(steps[0]!.instruction).toBe("i32.const 0");
    expect(steps[1]!.instruction).toBe("local.set 0");
    expect(steps[2]!.instruction).toBe("i32.const 0");
    expect(steps[3]!.instruction).toBe("local.set 1");

    // Loop structure present
    const instrs = steps.map((s) => s.instruction);
    expect(instrs).toContain("block");
    expect(instrs).toContain("loop");
    expect(instrs.filter((i) => i === "br 0").length).toBeGreaterThan(0);

    const last = steps[steps.length - 1]!;
    expect(last.instruction).toBe("return");
    const before = steps[steps.length - 2]!;
    expect(before.instruction).toBe("local.get 1");
    expect(before.stack.map((v) => v.bits)).toEqual([10]);
  });
});

describe("stepper sequence — recursion", () => {
  it("fib(6) returns 8 with nested calls", () => {
    const ir = lowerSource(`
      fn fib(n: i32) -> i32 {
        if (n <= 1) { return n; }
        return fib(n - 1) + fib(n - 2);
      }
      fn main() -> i32 { return fib(6); }
    `);
    const { steps, returnValue, trapped } = trace(ir);
    expect(trapped).toBe(false);
    expect(returnValue).toBe(8);

    expect(steps[0]!.instruction).toBe("i32.const 6");
    expect(steps[1]!.instruction).toBe("call $fib");

    const last = steps[steps.length - 1]!;
    expect(last.instruction).toBe("return");
    expect(last.funcName).toBe("main");

    // Nested fib frames appear in the trace
    expect(steps.some((s) => s.funcName === "fib")).toBe(true);
  });
});

/** Full Phase 1 / 3 corpus shared with optimizer-equivalence. */
const CORPUS: Array<[string, number]> = [
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
    `fn add(a: i32, b: i32) -> i32 { return a + b; }
     fn main() -> i32 { return add(3, 4); }`,
    7,
  ],
  [
    `fn fib(n: i32) -> i32 {
       if (n <= 1) { return n; }
       return fib(n - 1) + fib(n - 2);
     }
     fn main() -> i32 { return fib(10); }`,
    55,
  ],
  [
    `fn main() -> i32 {
       let a = 1;
       let b = 2;
       {
         let a = 10;
         b = a + b;
       }
       return a + b;
     }`,
    13,
  ],
];

describe("stepper vs real WASM execution", () => {
  it.each(CORPUS)("agrees with wabt for %#", async (source, expected) => {
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir).not.toBeNull();

    const stepped = trace(result.ir!);
    expect(stepped.trapped).toBe(false);
    expect(stepped.returnValue).toBe(expected);

    await validateWat(result.wat!);
    const exports = await compileAndInstantiate(result.wat!);
    const real = exports.main();
    expect(stepped.returnValue).toBe(real);
  });
});

describe("stepper vs real WASM — phase 7 prints", () => {
  const PRINT_CASES: Array<[string, number, string[]]> = [
    [
      `fn main() -> i32 {
         print_i32(10);
         print_i32(20);
         return 30;
       }`,
      30,
      ["10", "20"],
    ],
    [
      `fn main() -> i32 {
         let s = "hi";
         print_str(s);
         return 0;
       }`,
      0,
      ["hi"],
    ],
    [
      `fn main() -> i32 {
         let a = [10, 20, 30];
         print_i32(a[0]);
         print_i32(a[1]);
         print_i32(a[2]);
         return 20;
       }`,
      20,
      ["10", "20", "30"],
    ],
  ];

  it.each(PRINT_CASES)(
    "agrees on return + prints for %#",
    async (source, expected, expectedPrints) => {
      const result = compile(source);
      expect(result.diagnostics).toEqual([]);
      expect(result.ir).not.toBeNull();

      const stepped = trace(result.ir!);
      expect(stepped.trapped).toBe(false);
      expect(stepped.returnValue).toBe(expected);
      expect(stepped.prints).toEqual(expectedPrints);

      const { exports, output } = await compileAndInstantiateWithPrints(
        result.wat!,
      );
      const real = exports.main();
      expect(real).toBe(expected);
      expect(output).toEqual(expectedPrints);
      expect(stepped.returnValue).toBe(real);
      expect(stepped.prints).toEqual(output);
    },
  );
});
