import type { IRModule, IRStmt } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import {
  constantFold,
  countInstructions,
  optimize,
} from "../optimizer/index.js";
import { parse } from "../parser.js";
import { check } from "../typechecker.js";

function lowerSource(source: string): IRModule {
  const tokens = lex(source);
  const { program, diagnostics: parseDiags } = parse(tokens);
  expect(parseDiags).toEqual([]);
  const { typedProgram, diagnostics } = check(program);
  expect(diagnostics).toEqual([]);
  expect(typedProgram).not.toBeNull();
  return lower(typedProgram!);
}

function mainBody(ir: IRModule): IRStmt[] {
  return ir.functions.find((f) => f.name === "main")!.body;
}

describe("constant folding — golden IR", () => {
  it("folds 2 + 3 * 4 to Const 14 in LocalSet", () => {
    const ir = lowerSource(
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    );
    const folded = constantFold.run(ir);
    expect(mainBody(folded)[0]).toMatchObject({
      kind: "LocalSet",
      index: 0,
      value: { kind: "Const", type: "i32", value: 14 },
    });
  });

  it("exact golden: return 10 + 5 → Return(Const 15) only (DCE drops Unreachable)", () => {
    const ir = lowerSource("fn main() -> i32 { return 10 + 5; }");
    const opt = optimize(ir);
    expect(mainBody(opt)).toEqual([
      { kind: "Return", value: { kind: "Const", type: "i32", value: 15 } },
    ]);
  });

  it("exact golden: let x = 1 + 2; return x", () => {
    const ir = lowerSource("fn main() -> i32 { let x = 1 + 2; return x; }");
    const opt = optimize(ir);
    expect(mainBody(opt)).toEqual([
      {
        kind: "LocalSet",
        index: 0,
        value: { kind: "Const", type: "i32", value: 3 },
      },
      {
        kind: "Return",
        value: { kind: "LocalGet", type: "i32", index: 0 },
      },
    ]);
  });

  it("folds nested arithmetic: (2 + 3) * 4 → Const 20", () => {
    const ir = lowerSource("fn main() -> i32 { return (2 + 3) * 4; }");
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "Return",
      value: { kind: "Const", type: "i32", value: 20 },
    });
  });

  it("folds comparison in if condition: 3 < 5 → Const 1", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (3 < 5) { return 1; } else { return 0; }
      }
    `);
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "IfStmt",
      cond: { kind: "Const", type: "i32", value: 1 },
    });
  });

  it("folds 1 == 1 && 2 != 3 via IfExpr collapse to Const 1", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (1 == 1 && 2 != 3) { return 1; } else { return 0; }
      }
    `);
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "IfStmt",
      cond: { kind: "Const", type: "i32", value: 1 },
    });
  });

  it("folds unary minus: -7 → Const -7", () => {
    const ir = lowerSource("fn main() -> i32 { return -7; }");
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "Return",
      value: { kind: "Const", type: "i32", value: -7 },
    });
  });

  it("folds eqz: !(false) → Const 1", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (!(false)) { return 1; } else { return 0; }
      }
    `);
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "IfStmt",
      cond: { kind: "Const", type: "i32", value: 1 },
    });
  });

  it("folds i32 wrapping: 2147483647 + 1 → INT_MIN", () => {
    const ir = lowerSource("fn main() -> i32 { return 2147483647 + 1; }");
    const opt = constantFold.run(ir);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "Return",
      value: { kind: "Const", type: "i32", value: -2147483648 },
    });
  });

  it("reduces instruction count on arithmetic benchmark", () => {
    const ir = lowerSource(
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
    );
    const opt = optimize(ir);
    expect(countInstructions(opt)).toBeLessThan(countInstructions(ir));
  });
});
