import { compile } from "../pipeline.js";
import {
  compileAndInstantiateWithPrints,
  validateWat,
} from "./wabt-helper.js";

async function runWithPrints(source: string): Promise<{
  value: number;
  output: string[];
  wat: string;
}> {
  const result = compile(source);
  expect(result.diagnostics).toEqual([]);
  expect(result.wat).not.toBeNull();
  await validateWat(result.wat!);
  const { exports, output } = await compileAndInstantiateWithPrints(
    result.wat!,
  );
  return { value: exports.main(), output, wat: result.wat! };
}

describe("codegen phase 7 — strings, arrays, memory, prints", () => {
  it("builds a string, prints it via print_str, asserts captured output", async () => {
    const { value, output, wat } = await runWithPrints(`
      fn main() -> i32 {
        let s = "hello";
        print_str(s);
        return 0;
      }
    `);
    expect(value).toBe(0);
    expect(output).toEqual(["hello"]);
    expect(wat).toContain('(import "env" "print_str"');
    expect(wat).toContain('(memory (export "memory")');
    expect(wat).toContain("(data");
  });

  it("builds an i32 array, indexes valid positions, prints results", async () => {
    const { value, output, wat } = await runWithPrints(`
      fn main() -> i32 {
        let a = [10, 20, 30];
        print_i32(a[0]);
        print_i32(a[1]);
        print_i32(a[2]);
        return a[1];
      }
    `);
    expect(value).toBe(20);
    expect(output).toEqual(["10", "20", "30"]);
    expect(wat).toContain("call $alloc");
    expect(wat).toContain("(global $hp");
  });

  it("string indexing yields i32 codepoint", async () => {
    const { value, output } = await runWithPrints(`
      fn main() -> i32 {
        let s = "ABC";
        print_i32(s[0]);
        print_i32(s[1]);
        print_i32(s[2]);
        return s[0];
      }
    `);
    expect(value).toBe(65); // 'A'
    expect(output).toEqual(["65", "66", "67"]);
  });

  it("f64 array build/index works", async () => {
    const { value } = await runWithPrints(`
      fn main() -> i32 {
        let a = [1.5, 2.5, 3.5];
        if (a[0] < 2.0) {
          return 1;
        } else {
          return 0;
        }
      }
    `);
    expect(value).toBe(1);
  });

  it("array element assignment updates memory", async () => {
    const { value, output } = await runWithPrints(`
      fn main() -> i32 {
        let a = [1, 2, 3];
        a[1] = 99;
        print_i32(a[0]);
        print_i32(a[1]);
        print_i32(a[2]);
        return a[1];
      }
    `);
    expect(value).toBe(99);
    expect(output).toEqual(["1", "99", "3"]);
  });

  it("identical string literals are deduplicated", async () => {
    const result = compile(`
      fn main() -> i32 {
        let a = "hi";
        let b = "hi";
        print_str(a);
        print_str(b);
        return 0;
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir).not.toBeNull();
    // One unique literal → one data segment
    expect(result.ir!.dataSegments).toHaveLength(1);
  });

  it("out-of-bounds index at length traps via unreachable", async () => {
    const result = compile(`
      fn main() -> i32 {
        let a = [10, 20];
        return a[2];
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.wat).not.toBeNull();
    await validateWat(result.wat!);
    const { exports } = await compileAndInstantiateWithPrints(result.wat!);
    expect(() => exports.main()).toThrow();
  });

  it("out-of-bounds negative index traps via unreachable", async () => {
    const result = compile(`
      fn main() -> i32 {
        let a = [10, 20];
        return a[0 - 1];
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.wat).not.toBeNull();
    await validateWat(result.wat!);
    const { exports } = await compileAndInstantiateWithPrints(result.wat!);
    expect(() => exports.main()).toThrow();
  });

  it("string out-of-bounds index traps", async () => {
    const result = compile(`
      fn main() -> i32 {
        let s = "ab";
        return s[5];
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.wat).not.toBeNull();
    await validateWat(result.wat!);
    const { exports } = await compileAndInstantiateWithPrints(result.wat!);
    expect(() => exports.main()).toThrow();
  });

  it("all Phase 7 programs pass parseWat + validate()", async () => {
    const programs = [
      `fn main() -> i32 { let s = "hi"; print_str(s); return 0; }`,
      `fn main() -> i32 { let a = [1, 2, 3]; return a[0] + a[2]; }`,
      `fn main() -> i32 { let a = [1, 2]; a[0] = 7; return a[0]; }`,
      `fn main() -> i32 { let s = "x"; return s[0]; }`,
      `fn main() -> i32 { let a = [1.0, 2.0]; if (a[1] > 1.5) { return 1; } else { return 0; } }`,
      `fn main() -> i32 {
        let a = [1, 2, 3, 4, 5];
        let i = 0;
        let sum = 0;
        while (i < 5) {
          sum = sum + a[i];
          i = i + 1;
        }
        print_i32(sum);
        return sum;
      }`,
    ];
    for (const src of programs) {
      const result = compile(src);
      expect(result.diagnostics, src).toEqual([]);
      expect(result.wat).not.toBeNull();
      await expect(validateWat(result.wat!), src).resolves.toBeUndefined();
      // Also validate optimized WAT
      expect(result.optimizedWat).not.toBeNull();
      await expect(
        validateWat(result.optimizedWat!),
        `optimized: ${src}`,
      ).resolves.toBeUndefined();
    }
  });

  it("print_i32 alone does not require allocator", async () => {
    const result = compile(`
      fn main() -> i32 {
        print_i32(42);
        return 0;
      }
    `);
    expect(result.diagnostics).toEqual([]);
    expect(result.ir!.usesAllocator).toBe(false);
    expect(result.ir!.usesMemory).toBe(false);
    expect(result.wat!).toContain("print_i32");
    expect(result.wat!).not.toContain("call $alloc");
  });

  it("type error: cannot assign to string element", () => {
    const result = compile(`
      fn main() -> i32 {
        let s = "hi";
        s[0] = 65;
        return 0;
      }
    `);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some((d) =>
      d.message.includes("cannot assign to string element"),
    )).toBe(true);
  });

  it("type error: redeclaring print_i32 is rejected", () => {
    const result = compile(`
      fn print_i32(x: i32) { }
      fn main() -> i32 { return 0; }
    `);
    expect(result.diagnostics.some((d) =>
      d.message.includes("already declared"),
    )).toBe(true);
  });
});
