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

describe("codegen (end-to-end)", () => {
  it("exit criteria: let x = 2 + 3 * 4; return x; → 14", async () => {
    const result = await runMain(
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    );
    expect(result).toBe(14);
  });

  it("returns a constant", async () => {
    expect(await runMain("fn main() -> i32 { return 42; }")).toBe(42);
  });

  it("addition", async () => {
    expect(await runMain("fn main() -> i32 { return 10 + 5; }")).toBe(15);
  });

  it("subtraction", async () => {
    expect(await runMain("fn main() -> i32 { return 10 - 3; }")).toBe(7);
  });

  it("multiplication", async () => {
    expect(await runMain("fn main() -> i32 { return 6 * 7; }")).toBe(42);
  });

  it("division", async () => {
    expect(await runMain("fn main() -> i32 { return 20 / 4; }")).toBe(5);
  });

  it("modulo", async () => {
    expect(await runMain("fn main() -> i32 { return 17 % 5; }")).toBe(2);
  });

  it("unary minus", async () => {
    expect(await runMain("fn main() -> i32 { return -7; }")).toBe(-7);
  });

  it("parentheses override precedence", async () => {
    expect(await runMain("fn main() -> i32 { return (2 + 3) * 4; }")).toBe(20);
  });

  it("left-associative subtraction", async () => {
    expect(await runMain("fn main() -> i32 { return 10 - 3 - 2; }")).toBe(5);
  });

  it("multiple lets", async () => {
    const result = await runMain(`
      fn main() -> i32 {
        let a = 2;
        let b = 3;
        let c = a * b + 1;
        return c;
      }
    `);
    expect(result).toBe(7);
  });

  it("typed let annotation", async () => {
    expect(
      await runMain("fn main() -> i32 { let x: i32 = 99; return x; }"),
    ).toBe(99);
  });

  it("generated WAT is well-formed S-expressions", () => {
    const { wat, diagnostics } = compile(
      "fn main() -> i32 { let x = 1 + 2; return x; }",
    );
    expect(diagnostics).toEqual([]);
    expect(wat).toContain("(module");
    expect(wat).toContain('(func $main (export "main") (result i32)');
    expect(wat).toContain("(local i32)");
    expect(wat).toContain("i32.const 1");
    expect(wat).toContain("i32.const 2");
    expect(wat).toContain("i32.add");
    expect(wat).toContain("local.set 0");
    expect(wat).toContain("local.get 0");
    expect(wat).toContain("return");
  });

  it("all generated WAT passes wat2wasm validation", async () => {
    const programs = [
      "fn main() -> i32 { return 0; }",
      "fn main() -> i32 { let x = 1; return x; }",
      "fn main() -> i32 { return 1 + 2 * 3 - 4 / 2 % 2; }",
      "fn main() -> i32 { let a = -1; let b = -a; return b; }",
    ];
    for (const src of programs) {
      const { wat, diagnostics } = compile(src);
      expect(diagnostics, `diagnostics for: ${src}`).toEqual([]);
      await expect(validateWat(wat!), `validate: ${src}`).resolves.toBeUndefined();
    }
  });
});
