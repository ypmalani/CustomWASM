import { emit } from "../codegen.js";
import type { IRStmt } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import { parse } from "../parser.js";
import { check } from "../typechecker.js";
import { validateWat } from "./wabt-helper.js";

function lowerSource(source: string) {
  const tokens = lex(source);
  const { program, diagnostics: parseDiags } = parse(tokens);
  expect(parseDiags).toEqual([]);
  const { typedProgram, diagnostics } = check(program);
  expect(diagnostics).toEqual([]);
  expect(typedProgram).not.toBeNull();
  return lower(typedProgram!);
}

describe("lower — while desugaring", () => {
  it("lowers while to Block { Loop { BrIf(eqz(cond), 1); body; Br(0) } }", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        let i = 0;
        while (i < 5) {
          i = i + 1;
        }
        return i;
      }
    `);

    const main = ir.functions[0]!;
    expect(main.name).toBe("main");
    // body: LocalSet(i), Block(while), Return, Unreachable
    expect(main.body).toHaveLength(4);

    const whileBlock = main.body[1]!;
    expect(whileBlock.kind).toBe("Block");
    if (whileBlock.kind !== "Block") return;

    expect(whileBlock.body).toHaveLength(1);
    const loop = whileBlock.body[0]!;
    expect(loop.kind).toBe("Loop");
    if (loop.kind !== "Loop") return;

    // Loop body: BrIf, LocalSet (i = i + 1), Br
    expect(loop.body.length).toBeGreaterThanOrEqual(3);

    const brIf = loop.body[0]!;
    expect(brIf.kind).toBe("BrIf");
    if (brIf.kind !== "BrIf") return;
    expect(brIf.target).toBe(1); // exit block
    expect(brIf.cond.kind).toBe("UnOp");
    if (brIf.cond.kind === "UnOp") {
      expect(brIf.cond.op).toBe("eqz");
      // cond operand is BinOp lt (i < 5)
      expect(brIf.cond.operand.kind).toBe("BinOp");
      if (brIf.cond.operand.kind === "BinOp") {
        expect(brIf.cond.operand.op).toBe("lt");
      }
    }

    const br = loop.body[loop.body.length - 1]!;
    expect(br.kind).toBe("Br");
    if (br.kind === "Br") {
      expect(br.target).toBe(0); // continue to loop head
    }
  });

  it("while IR has exact block/loop nesting with relative depths", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        let i = 0;
        while (true) {
          return i;
        }
        return 0;
      }
    `);

    const whileStmt = ir.functions[0]!.body[1]!;
    // Shape snapshot of the while template
    expect(whileStmt).toMatchObject({
      kind: "Block",
      body: [
        {
          kind: "Loop",
          body: [
            {
              kind: "BrIf",
              target: 1,
              cond: { kind: "UnOp", op: "eqz" },
            },
            { kind: "Return" },
            { kind: "Br", target: 0 },
          ],
        },
      ],
    });
  });
});

describe("lower — short-circuit && / ||", () => {
  it("lowers && to IfExpr(left, right, Const 0)", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (true && false) { return 1; } else { return 0; }
      }
    `);

    const ifStmt = ir.functions[0]!.body[0]!;
    expect(ifStmt.kind).toBe("IfStmt");
    if (ifStmt.kind !== "IfStmt") return;

    const cond = ifStmt.cond;
    expect(cond.kind).toBe("IfExpr");
    if (cond.kind !== "IfExpr") return;

    expect(cond.cond).toMatchObject({ kind: "Const", value: 1 }); // true
    expect(cond.then).toMatchObject({ kind: "Const", value: 0 }); // false
    expect(cond.else_).toMatchObject({ kind: "Const", type: "i32", value: 0 });
  });

  it("lowers || to IfExpr(left, Const 1, right)", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        if (false || true) { return 1; } else { return 0; }
      }
    `);

    const ifStmt = ir.functions[0]!.body[0]!;
    expect(ifStmt.kind).toBe("IfStmt");
    if (ifStmt.kind !== "IfStmt") return;

    const cond = ifStmt.cond;
    expect(cond.kind).toBe("IfExpr");
    if (cond.kind !== "IfExpr") return;

    expect(cond.cond).toMatchObject({ kind: "Const", value: 0 }); // false
    expect(cond.then).toMatchObject({ kind: "Const", type: "i32", value: 1 });
    expect(cond.else_).toMatchObject({ kind: "Const", value: 1 }); // true
  });
});

describe("lower — Drop and local indices", () => {
  it("wraps non-void ExprStmt in Drop", () => {
    const ir = lowerSource(`
      fn side() -> i32 { return 1; }
      fn main() -> i32 {
        side();
        return 0;
      }
    `);

    const main = ir.functions.find((f) => f.name === "main")!;
    const drop = main.body[0]!;
    expect(drop.kind).toBe("Drop");
    if (drop.kind === "Drop") {
      expect(drop.value.kind).toBe("CallExpr");
    }
  });

  it("assigns dense local indices: params first, then lets in DFS order", () => {
    const ir = lowerSource(`
      fn add(a: i32, b: i32) -> i32 {
        let c = a + b;
        return c;
      }
      fn main() -> i32 {
        return add(1, 2);
      }
    `);

    const add = ir.functions.find((f) => f.name === "add")!;
    expect(add.params).toEqual(["i32", "i32"]);
    expect(add.locals).toEqual(["i32"]); // c at index 2

    // LocalSet for c uses index 2
    const setC = add.body[0]!;
    expect(setC).toMatchObject({ kind: "LocalSet", index: 2 });

    // Return uses LocalGet 2
    const ret = add.body[1]!;
    expect(ret.kind).toBe("Return");
    if (ret.kind === "Return" && ret.value) {
      expect(ret.value).toMatchObject({ kind: "LocalGet", index: 2 });
    }
  });

  it("shadowing: inner let gets a distinct local index", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        let x = 1;
        {
          let x = 100;
          x = x + 1;
        }
        return x;
      }
    `);

    const main = ir.functions[0]!;
    expect(main.locals).toEqual(["i32", "i32"]); // outer x=0, inner x=1

    // First LocalSet is outer x at index 0
    expect(main.body[0]).toMatchObject({ kind: "LocalSet", index: 0 });

    // Inner block: LocalSet index 1, then LocalSet index 1 (assign)
    // Find the LocalSet with index 1 for the inner let
    const sets = collectLocalSets(main.body);
    expect(sets).toContainEqual({ index: 0, init: true });
    expect(sets.filter((s) => s.index === 1).length).toBeGreaterThanOrEqual(1);

    // Return reads outer x (index 0)
    const ret = main.body.find((s) => s.kind === "Return");
    expect(ret).toBeDefined();
    if (ret && ret.kind === "Return" && ret.value) {
      expect(ret.value).toMatchObject({ kind: "LocalGet", index: 0 });
    }
  });
});

function collectLocalSets(
  stmts: IRStmt[],
): Array<{ index: number; init: boolean }> {
  const out: Array<{ index: number; init: boolean }> = [];
  function walk(ss: IRStmt[]) {
    for (const s of ss) {
      if (s.kind === "LocalSet") {
        out.push({ index: s.index, init: true });
      } else if (s.kind === "Block" || s.kind === "Loop") {
        walk(s.body);
      } else if (s.kind === "IfStmt") {
        walk(s.then);
        if (s.else_) walk(s.else_);
      }
    }
  }
  walk(stmts);
  return out;
}

describe("lower — emit + wat2wasm validation", () => {
  it("lowered programs emit WAT that passes parseWat + validate()", async () => {
    const programs = [
      "fn main() -> i32 { let x = 2 + 3 * 4; return x; }",
      `fn main() -> i32 {
        let i = 0;
        let sum = 0;
        while (i < 5) {
          sum = sum + i;
          i = i + 1;
        }
        return sum;
      }`,
      `fn fib(n: i32) -> i32 {
        if (n <= 1) { return n; }
        else { return fib(n - 1) + fib(n - 2); }
      }
      fn main() -> i32 { return fib(10); }`,
      `fn main() -> i32 {
        if (1 == 1 && 2 != 3 || !(false)) { return 1; } else { return 0; }
      }`,
      `fn main() -> i32 {
        let x = 1;
        { let x = 100; x = x + 1; }
        return x;
      }`,
    ];

    for (const src of programs) {
      const ir = lowerSource(src);
      const wat = emit(ir);
      expect(wat).toContain("(module");
      await expect(
        validateWat(wat),
        `validate: ${src}`,
      ).resolves.toBeUndefined();
    }
  });

  it("simple arithmetic IR shape: Const / BinOp / LocalSet / Return", () => {
    const ir = lowerSource(
      "fn main() -> i32 { let x = 1 + 2; return x; }",
    );
    const main = ir.functions[0]!;
    expect(main.locals).toEqual(["i32"]);
    expect(main.body[0]).toMatchObject({
      kind: "LocalSet",
      index: 0,
      value: {
        kind: "BinOp",
        op: "add",
        left: { kind: "Const", value: 1 },
        right: { kind: "Const", value: 2 },
      },
    });
    expect(main.body[1]).toMatchObject({
      kind: "Return",
      value: { kind: "LocalGet", index: 0 },
    });
    expect(main.body[2]).toMatchObject({ kind: "Unreachable" });
  });
});
