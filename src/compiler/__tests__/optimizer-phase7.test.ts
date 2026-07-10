import { emit } from "../codegen.js";
import type { IRExpr, IRModule, IRStmt } from "../ir.js";
import { lex } from "../lexer.js";
import { lower } from "../lower.js";
import { optimize } from "../optimizer/index.js";
import { parse } from "../parser.js";
import { check } from "../typechecker.js";
import {
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

function findAlloc(expr: IRExpr): boolean {
  switch (expr.kind) {
    case "Alloc":
      return true;
    case "BinOp":
      return findAlloc(expr.left) || findAlloc(expr.right);
    case "UnOp":
      return findAlloc(expr.operand);
    case "CallExpr":
      return expr.args.some(findAlloc);
    case "Load":
      return findAlloc(expr.addr);
    case "IfExpr":
      return (
        findAlloc(expr.cond) || findAlloc(expr.then) || findAlloc(expr.else_)
      );
    case "BlockExpr":
      return findAllocInStmts(expr.body) || findAlloc(expr.result);
    default:
      return false;
  }
}

function findAllocInStmts(stmts: IRStmt[]): boolean {
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "Block":
      case "Loop":
        if (findAllocInStmts(stmt.body)) return true;
        break;
      case "IfStmt":
        if (findAlloc(stmt.cond)) return true;
        if (findAllocInStmts(stmt.then)) return true;
        if (stmt.else_ && findAllocInStmts(stmt.else_)) return true;
        break;
      case "LocalSet":
        if (findAlloc(stmt.value)) return true;
        break;
      case "Store":
        if (findAlloc(stmt.addr) || findAlloc(stmt.value)) return true;
        break;
      case "CallStmt":
        if (stmt.args.some(findAlloc)) return true;
        break;
      case "Drop":
        if (findAlloc(stmt.value)) return true;
        break;
      case "Return":
        if (stmt.value && findAlloc(stmt.value)) return true;
        break;
      case "BrIf":
        if (findAlloc(stmt.cond)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

function countStores(stmts: IRStmt[]): number {
  let n = 0;
  for (const stmt of stmts) {
    switch (stmt.kind) {
      case "Store":
        n++;
        break;
      case "Block":
      case "Loop":
        n += countStores(stmt.body);
        break;
      case "IfStmt":
        n += countStores(stmt.then);
        if (stmt.else_) n += countStores(stmt.else_);
        break;
      case "LocalSet":
        n += countStoresInExpr(stmt.value);
        break;
      case "Drop":
        n += countStoresInExpr(stmt.value);
        break;
      case "Return":
        if (stmt.value) n += countStoresInExpr(stmt.value);
        break;
      default:
        break;
    }
  }
  return n;
}

function countStoresInExpr(expr: IRExpr): number {
  switch (expr.kind) {
    case "BlockExpr":
      return countStores(expr.body) + countStoresInExpr(expr.result);
    case "BinOp":
      return countStoresInExpr(expr.left) + countStoresInExpr(expr.right);
    case "UnOp":
      return countStoresInExpr(expr.operand);
    case "CallExpr":
      return expr.args.reduce((n, a) => n + countStoresInExpr(a), 0);
    case "Load":
      return countStoresInExpr(expr.addr);
    case "IfExpr":
      return (
        countStoresInExpr(expr.cond) +
        countStoresInExpr(expr.then) +
        countStoresInExpr(expr.else_)
      );
    case "Alloc":
      return countStoresInExpr(expr.size);
    default:
      return 0;
  }
}

describe("optimizer phase 7 — DCE / allocation regression", () => {
  it("preserves Alloc and Stores for array construction after optimize", () => {
    const ir = lowerSource(`
      fn main() -> i32 {
        let a = [10, 20, 30];
        return a[1];
      }
    `);
    const optimized = optimize(ir);

    expect(findAllocInStmts(ir.functions[0]!.body)).toBe(true);
    expect(findAllocInStmts(optimized.functions[0]!.body)).toBe(true);

    // Array of 3 elements: 1 length store + 3 element stores = 4
    const storesBefore = countStores(ir.functions[0]!.body);
    const storesAfter = countStores(optimized.functions[0]!.body);
    expect(storesBefore).toBeGreaterThanOrEqual(4);
    expect(storesAfter).toBe(storesBefore);
  });

  it("optimized and unoptimized produce identical runtime results for arrays", async () => {
    const source = `
      fn main() -> i32 {
        let a = [10, 20, 30];
        print_i32(a[0]);
        print_i32(a[2]);
        return a[1];
      }
    `;
    const ir = lowerSource(source);
    const optimized = optimize(ir);

    const unoptWat = emit(ir);
    const optWat = emit(optimized);
    await validateWat(unoptWat);
    await validateWat(optWat);

    const unopt = await compileAndInstantiateWithPrints(unoptWat);
    const opt = await compileAndInstantiateWithPrints(optWat);

    const unoptVal = unopt.exports.main();
    const optVal = opt.exports.main();
    expect(optVal).toBe(unoptVal);
    expect(opt.output).toEqual(unopt.output);
    expect(unoptVal).toBe(20);
    expect(unopt.output).toEqual(["10", "30"]);
  });

  it("DCE removes unused pure local without corrupting array temp indices", async () => {
    const source = `
      fn main() -> i32 {
        let dead = 1 + 2;
        let a = [5, 6, 7];
        return a[0] + a[2];
      }
    `;
    const ir = lowerSource(source);
    const optimized = optimize(ir);

    // Unoptimized has the dead local; optimized should have fewer locals
    // (dead removed) but array temps must remain and be correctly remapped.
    expect(optimized.functions[0]!.locals.length).toBeLessThan(
      ir.functions[0]!.locals.length,
    );

    // Alloc must survive
    expect(findAllocInStmts(optimized.functions[0]!.body)).toBe(true);

    const optWat = emit(optimized);
    await validateWat(optWat);
    const { exports } = await compileAndInstantiateWithPrints(optWat);
    expect(exports.main()).toBe(12); // 5 + 7
  });

  it("optimized string print matches unoptimized", async () => {
    const source = `
      fn main() -> i32 {
        let s = "hello";
        print_str(s);
        return s[0];
      }
    `;
    const ir = lowerSource(source);
    const optimized = optimize(ir);

    const unopt = await compileAndInstantiateWithPrints(emit(ir));
    const opt = await compileAndInstantiateWithPrints(emit(optimized));

    const unoptVal = unopt.exports.main();
    const optVal = opt.exports.main();
    expect(optVal).toBe(unoptVal);
    expect(opt.output).toEqual(unopt.output);
    expect(unopt.output).toEqual(["hello"]);
    expect(unoptVal).toBe(104); // 'h'
  });

  it("OOB trap is preserved through optimization", async () => {
    const source = `
      fn main() -> i32 {
        let a = [1, 2];
        return a[2];
      }
    `;
    const ir = lowerSource(source);
    const optimized = optimize(ir);
    const wat = emit(optimized);
    await validateWat(wat);
    const { exports } = await compileAndInstantiateWithPrints(wat);
    expect(() => exports.main()).toThrow();
  });
});
