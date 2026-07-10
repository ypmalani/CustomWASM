import type { IRModule, IRStmt } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import {
  constantFold,
  deadCodeElimination,
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

function main(ir: IRModule) {
  return ir.functions.find((f) => f.name === "main")!;
}

function mainBody(ir: IRModule): IRStmt[] {
  return main(ir).body;
}

describe("dead code elimination — golden IR", () => {
  it("truncates statements after return", () => {
    // Lowering appends Unreachable after Return for non-void functions.
    // DCE must drop everything after Return.
    const ir = lowerSource("fn main() -> i32 { return 1; }");
    expect(mainBody(ir).map((s) => s.kind)).toEqual([
      "Return",
      "Unreachable",
    ]);

    const dce = deadCodeElimination.run(ir);
    expect(mainBody(dce)).toEqual([
      { kind: "Return", value: { kind: "Const", type: "i32", value: 1 } },
    ]);
  });

  it("prunes if(true) to then arm only", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (true) { return 10; } else { return 20; }
      }
    `);
    // Fold first so cond becomes Const 1, then DCE splices then arm.
    const folded = constantFold.run(ir);
    const dce = deadCodeElimination.run(folded);
    expect(mainBody(dce)).toEqual([
      { kind: "Return", value: { kind: "Const", type: "i32", value: 10 } },
    ]);
  });

  it("prunes if(false) to else arm only", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (false) { return 10; } else { return 20; }
      }
    `);
    const folded = constantFold.run(ir);
    const dce = deadCodeElimination.run(folded);
    expect(mainBody(dce)).toEqual([
      { kind: "Return", value: { kind: "Const", type: "i32", value: 20 } },
    ]);
  });

  it("removes unused local and re-densifies indices", () => {
    // `dead` is written but never read; `used` is read.
    // After DCE: dead's LocalSet gone, used remapped from index 1 → 0.
    const ir = lowerSource(`
      fn main() -> i32 {
        let dead = 1 + 2;
        let used = 10;
        return used;
      }
    `);
    expect(main(ir).locals).toEqual(["i32", "i32"]);

    const opt = optimize(ir);
    expect(main(opt).locals).toEqual(["i32"]); // only `used` remains
    expect(mainBody(opt)).toEqual([
      {
        kind: "LocalSet",
        index: 0,
        value: { kind: "Const", type: "i32", value: 10 },
      },
      {
        kind: "Return",
        value: { kind: "LocalGet", type: "i32", index: 0 },
      },
    ]);
  });

  it("does not remove LocalSet of a call (side effects)", () => {
    const ir = lowerSource(`
      fn side() -> i32 { return 1; }
      fn main() -> i32 {
        let x = side();
        return 0;
      }
    `);
    const opt = optimize(ir);
    const body = mainBody(opt);
    // x is unread, but its init is a CallExpr — must keep the call for effects.
    // Our DCE only removes unread locals when ALL writes are side-effect-free.
    // So the LocalSet(CallExpr) must remain, and the local stays.
    const set = body.find((s) => s.kind === "LocalSet");
    expect(set).toBeDefined();
    if (set && set.kind === "LocalSet") {
      expect(set.value.kind).toBe("CallExpr");
    }
  });

  it("removes Drop of Const (side-effect-free)", () => {
    // ExprStmt of a non-void call becomes Drop(CallExpr) — keep that.
    // But Drop of a pure value: hard to get from source. Construct via fold:
    // after folding, a Drop of something that became Const shouldn't appear
    // from normal lowering of ExprStmt of literals... ExprStmt of `1+2;`
    // lowers to Drop(BinOp). After fold → Drop(Const) → DCE removes it.
    const ir = lowerSource(`
      fn main() -> i32 {
        1 + 2;
        return 0;
      }
    `);
    const opt = optimize(ir);
    expect(mainBody(opt).some((s) => s.kind === "Drop")).toBe(false);
    expect(mainBody(opt)[0]).toMatchObject({
      kind: "Return",
      value: { kind: "Const", type: "i32", value: 0 },
    });
  });
});
