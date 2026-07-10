import { emit } from "../codegen.js";
import type { IRExpr, IRModule, IRStmt } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import { constantFold, optimize } from "../optimizer/index.js";
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

function findBinOps(stmts: IRStmt[]): IRExpr[] {
  const found: IRExpr[] = [];
  function walkExpr(e: IRExpr) {
    if (e.kind === "BinOp") found.push(e);
    switch (e.kind) {
      case "BinOp":
        walkExpr(e.left);
        walkExpr(e.right);
        break;
      case "UnOp":
        walkExpr(e.operand);
        break;
      case "CallExpr":
        for (const a of e.args) walkExpr(a);
        break;
      case "IfExpr":
        walkExpr(e.cond);
        walkExpr(e.then);
        walkExpr(e.else_);
        break;
      case "Load":
        walkExpr(e.addr);
        break;
      default:
        break;
    }
  }
  function walkStmt(s: IRStmt) {
    switch (s.kind) {
      case "Block":
      case "Loop":
        for (const b of s.body) walkStmt(b);
        break;
      case "IfStmt":
        walkExpr(s.cond);
        for (const b of s.then) walkStmt(b);
        if (s.else_) for (const b of s.else_) walkStmt(b);
        break;
      case "BrIf":
        walkExpr(s.cond);
        break;
      case "LocalSet":
      case "Drop":
        walkExpr(s.value);
        break;
      case "Return":
        if (s.value) walkExpr(s.value);
        break;
      case "CallStmt":
        for (const a of s.args) walkExpr(a);
        break;
      case "Store":
        walkExpr(s.addr);
        walkExpr(s.value);
        break;
      default:
        break;
    }
  }
  for (const s of stmts) walkStmt(s);
  return found;
}

describe("trap preservation — never fold trapping ops", () => {
  it("does not fold division by zero", () => {
    const ir = lowerSource("fn main() -> i32 { return 10 / 0; }");
    const folded = constantFold.run(ir);
    const binops = findBinOps(folded.functions[0]!.body);
    expect(binops.length).toBe(1);
    expect(binops[0]).toMatchObject({
      kind: "BinOp",
      op: "div",
      left: { kind: "Const", value: 10 },
      right: { kind: "Const", value: 0 },
    });
  });

  it("does not fold rem by zero", () => {
    const ir = lowerSource("fn main() -> i32 { return 10 % 0; }");
    const folded = constantFold.run(ir);
    const binops = findBinOps(folded.functions[0]!.body);
    expect(binops.length).toBe(1);
    expect(binops[0]).toMatchObject({
      kind: "BinOp",
      op: "rem",
      right: { kind: "Const", value: 0 },
    });
  });

  it("does not fold INT_MIN / -1 (signed overflow trap)", () => {
    // -2147483648 / -1 traps in WASM i32.div_s
    const ir = lowerSource(
      "fn main() -> i32 { return -2147483648 / -1; }",
    );
    const folded = constantFold.run(ir);
    const binops = findBinOps(folded.functions[0]!.body);
    // Unary neg of 2147483648 may fold first; the div must remain.
    const div = binops.find((e) => e.kind === "BinOp" && e.op === "div");
    expect(div).toBeDefined();
    if (div && div.kind === "BinOp") {
      expect(div.right).toMatchObject({ kind: "Const", value: -1 });
      // Left should be INT_MIN (possibly after folding unary neg).
      expect(div.left).toMatchObject({
        kind: "Const",
        value: -2147483648,
      });
    }
  });

  it("DOES fold INT_MIN % -1 (WASM defines result as 0, no trap)", () => {
    const ir = lowerSource(
      "fn main() -> i32 { return -2147483648 % -1; }",
    );
    const folded = constantFold.run(ir);
    const ret = folded.functions[0]!.body[0]!;
    expect(ret).toMatchObject({
      kind: "Return",
      value: { kind: "Const", type: "i32", value: 0 },
    });
  });

  it("runtime: both unoptimized and optimized paths trap on div-by-zero", async () => {
    const ir = lowerSource("fn main() -> i32 { return 1 / 0; }");
    const opt = optimize(ir);

    const unoptWat = emit(ir);
    const optWat = emit(opt);
    await validateWat(unoptWat);
    await validateWat(optWat);

    const unoptExports = await compileAndInstantiate(unoptWat);
    const optExports = await compileAndInstantiate(optWat);

    expect(() => unoptExports.main()).toThrow();
    expect(() => optExports.main()).toThrow();
  });

  it("runtime: both paths trap on INT_MIN / -1", async () => {
    const ir = lowerSource(
      "fn main() -> i32 { return -2147483648 / -1; }",
    );
    const opt = optimize(ir);

    const unoptWat = emit(ir);
    const optWat = emit(opt);
    await validateWat(unoptWat);
    await validateWat(optWat);

    const unoptExports = await compileAndInstantiate(unoptWat);
    const optExports = await compileAndInstantiate(optWat);

    expect(() => unoptExports.main()).toThrow();
    expect(() => optExports.main()).toThrow();
  });
});
