import type { BinOp } from "./ast.js";
import type {
  IRBinOp,
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "./ir.js";
import type {
  TypedBlock,
  TypedExpr,
  TypedFunctionDecl,
  TypedProgram,
  TypedStmt,
} from "./typed-ast.js";
import type { Type } from "./types.js";

/**
 * Lower a well-typed AST to the tree-structured IR.
 * Total on well-typed input: any failure is a compiler bug and throws.
 * Never diagnoses — the type checker already passed.
 */

const STATIC_DATA_BASE = 1024; // 0x0400
const BUILTIN_PRINT_I32 = "print_i32";
const BUILTIN_PRINT_STR = "print_str";

type ScopeStack = Array<Map<string, number>>;

interface StringInterner {
  /** value → absolute memory offset of the length-prefixed object. */
  offsets: Map<string, number>;
  /** Ordered data segments (one per unique literal). */
  segments: { offset: number; bytes: Uint8Array }[];
  /** Next free byte after the last segment (not yet 8-aligned for heap). */
  nextOffset: number;
}

interface ModuleCtx {
  funcIndices: Map<string, number>;
  funcHasResult: Map<string, boolean>;
  imports: IRModule["imports"];
  strings: StringInterner;
  usesMemory: boolean;
  usesAllocator: boolean;
}

interface LowerCtx {
  /** Name → dense local index (params first, then lets in DFS order). */
  scopes: ScopeStack;
  /** Next free local index (continues after params). */
  nextLocalIndex: number;
  /** Wasm types of locals (not including params). */
  locals: WasmType[];
  /** Function name → module function index. */
  funcIndices: Map<string, number>;
  /** Function name → whether it has a result (for Drop vs CallStmt). */
  funcHasResult: Map<string, boolean>;
  /**
   * Enclosing label stack for relative branch depths.
   * Index 0 is the innermost label; relative depth = distance from top.
   */
  labelStack: number[];
  module: ModuleCtx;
}

function align8(n: number): number {
  return (n + 7) & ~7;
}

function encodeI32LE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  const view = new DataView(buf.buffer);
  view.setInt32(0, n, true);
  return buf;
}

function internString(strings: StringInterner, value: string): number {
  const existing = strings.offsets.get(value);
  if (existing !== undefined) return existing;

  const utf8 = new TextEncoder().encode(value);
  const header = encodeI32LE(utf8.length);
  const bytes = new Uint8Array(4 + utf8.length);
  bytes.set(header, 0);
  bytes.set(utf8, 4);

  const offset = strings.nextOffset;
  strings.offsets.set(value, offset);
  strings.segments.push({ offset, bytes });
  strings.nextOffset = align8(offset + bytes.length);
  return offset;
}

/** Scan the typed AST for used print builtins. */
function collectUsedBuiltins(typed: TypedProgram): Set<string> {
  const used = new Set<string>();
  function walkExpr(expr: TypedExpr): void {
    switch (expr.kind) {
      case "Call":
        if (expr.callee === BUILTIN_PRINT_I32 || expr.callee === BUILTIN_PRINT_STR) {
          used.add(expr.callee);
        }
        for (const a of expr.args) walkExpr(a);
        break;
      case "Unary":
        walkExpr(expr.operand);
        break;
      case "Binary":
        walkExpr(expr.left);
        walkExpr(expr.right);
        break;
      case "Index":
        walkExpr(expr.target);
        walkExpr(expr.index);
        break;
      case "ArrayLiteral":
        for (const e of expr.elements) walkExpr(e);
        break;
      default:
        break;
    }
  }
  function walkStmt(stmt: TypedStmt): void {
    switch (stmt.kind) {
      case "Let":
        walkExpr(stmt.init);
        break;
      case "Assign":
        walkExpr(stmt.target);
        walkExpr(stmt.value);
        break;
      case "If":
        walkExpr(stmt.cond);
        walkStmt(stmt.then);
        if (stmt.else_) walkStmt(stmt.else_);
        break;
      case "While":
        walkExpr(stmt.cond);
        walkStmt(stmt.body);
        break;
      case "Return":
        if (stmt.value) walkExpr(stmt.value);
        break;
      case "ExprStmt":
        walkExpr(stmt.expr);
        break;
      case "Block":
        for (const s of stmt.statements) walkStmt(s);
        break;
      default:
        break;
    }
  }
  for (const fn of typed.functions) {
    walkStmt(fn.body);
  }
  return used;
}

export function lower(typed: TypedProgram): IRModule {
  const usedBuiltins = collectUsedBuiltins(typed);

  // Imports-first function index space.
  const imports: IRModule["imports"] = [];
  const funcIndices = new Map<string, number>();
  const funcHasResult = new Map<string, boolean>();

  // Fixed order: print_i32 then print_str (only if used).
  if (usedBuiltins.has(BUILTIN_PRINT_I32)) {
    funcIndices.set(BUILTIN_PRINT_I32, imports.length);
    funcHasResult.set(BUILTIN_PRINT_I32, false);
    imports.push({
      module: "env",
      name: BUILTIN_PRINT_I32,
      params: ["i32"],
    });
  }
  if (usedBuiltins.has(BUILTIN_PRINT_STR)) {
    funcIndices.set(BUILTIN_PRINT_STR, imports.length);
    funcHasResult.set(BUILTIN_PRINT_STR, false);
    imports.push({
      module: "env",
      name: BUILTIN_PRINT_STR,
      params: ["i32"],
    });
  }

  const importCount = imports.length;
  for (let i = 0; i < typed.functions.length; i++) {
    const fn = typed.functions[i]!;
    funcIndices.set(fn.name, importCount + i);
    funcHasResult.set(fn.name, fn.resolvedReturnType.kind !== "void");
  }

  const moduleCtx: ModuleCtx = {
    funcIndices,
    funcHasResult,
    imports,
    strings: {
      offsets: new Map(),
      segments: [],
      nextOffset: STATIC_DATA_BASE,
    },
    usesMemory: imports.some((i) => i.name === BUILTIN_PRINT_STR) || false,
    usesAllocator: false,
  };

  // print_str needs memory to read string bytes; print_i32 alone does not.
  // String/array usage will set usesMemory/usesAllocator during lowering.

  const functions = typed.functions.map((fn) =>
    lowerFunction(fn, moduleCtx),
  );

  // If we interned any strings, memory is required.
  if (moduleCtx.strings.segments.length > 0) {
    moduleCtx.usesMemory = true;
  }

  const heapBase = align8(moduleCtx.strings.nextOffset);

  return {
    functions,
    imports,
    dataSegments: moduleCtx.strings.segments,
    memoryPages: 1,
    heapBase,
    usesMemory: moduleCtx.usesMemory,
    usesAllocator: moduleCtx.usesAllocator,
  };
}

function lowerFunction(
  fn: TypedFunctionDecl,
  module: ModuleCtx,
): IRFunction {
  const params: WasmType[] = fn.params.map((p) => typeToWasm(p.resolvedType));
  const scopes: ScopeStack = [new Map()];
  for (let i = 0; i < fn.params.length; i++) {
    scopes[0]!.set(fn.params[i]!.name, i);
  }

  const ctx: LowerCtx = {
    scopes,
    nextLocalIndex: fn.params.length,
    locals: [],
    funcIndices: module.funcIndices,
    funcHasResult: module.funcHasResult,
    labelStack: [],
    module,
  };

  const body = lowerBlockStmts(fn.body, ctx);

  const result =
    fn.resolvedReturnType.kind === "void"
      ? undefined
      : typeToWasm(fn.resolvedReturnType);

  // Trailing unreachable so WASM validation accepts the function end when
  // the last statement is an if/while whose arms return (control never falls
  // through, but the type checker still wants an i32 or an unreachable end).
  if (result !== undefined) {
    body.push({ kind: "Unreachable" });
  }

  return {
    name: fn.name,
    params,
    locals: ctx.locals,
    result,
    body,
    exported: fn.name === "main",
  };
}

function typeToWasm(t: Type): WasmType {
  switch (t.kind) {
    case "i32":
    case "bool":
      return "i32";
    case "f64":
      return "f64";
    case "string":
    case "array":
      // Pointers into linear memory.
      return "i32";
    case "void":
      throw new Error("lower: cannot map void to WasmType");
    case "error":
      throw new Error("lower: unexpected error type in well-typed AST");
    default: {
      const _exhaustive: never = t;
      throw new Error(`lower: unhandled type ${(_exhaustive as Type).kind}`);
    }
  }
}

/** Element stride in bytes for array/string indexing. */
function elementStride(t: Type): number {
  if (t.kind === "string") return 1;
  if (t.kind === "array") {
    const elem = t.element;
    if (elem.kind === "f64") return 8;
    // i32, bool, string, array (pointers) → 4
    return 4;
  }
  throw new Error(`lower: elementStride on non-indexable type ${t.kind}`);
}

function resolveLocal(name: string, scopes: ScopeStack): number {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const idx = scopes[i]!.get(name);
    if (idx !== undefined) return idx;
  }
  throw new Error(`lower: unbound identifier '${name}'`);
}

/** Relative depth of a label: 0 = innermost. */
function relativeDepth(ctx: LowerCtx, label: number): number {
  for (let i = ctx.labelStack.length - 1; i >= 0; i--) {
    if (ctx.labelStack[i] === label) {
      return ctx.labelStack.length - 1 - i;
    }
  }
  throw new Error(`lower: label ${label} not on label stack`);
}

function pushScope(ctx: LowerCtx): void {
  ctx.scopes.push(new Map());
}

function popScope(ctx: LowerCtx): void {
  ctx.scopes.pop();
}

/** Allocate a fresh synthetic local and return its index. */
function allocTemp(ctx: LowerCtx, type: WasmType): number {
  const index = ctx.nextLocalIndex++;
  ctx.locals.push(type);
  return index;
}

// ---- Statements ----

function lowerBlockStmts(block: TypedBlock, ctx: LowerCtx): IRStmt[] {
  pushScope(ctx);
  const stmts: IRStmt[] = [];
  for (const stmt of block.statements) {
    stmts.push(...lowerStmt(stmt, ctx));
  }
  popScope(ctx);
  return stmts;
}

function lowerStmt(stmt: TypedStmt, ctx: LowerCtx): IRStmt[] {
  switch (stmt.kind) {
    case "Let": {
      const value = lowerExpr(stmt.init, ctx);
      const index = ctx.nextLocalIndex++;
      ctx.locals.push(typeToWasm(stmt.type));
      ctx.scopes[ctx.scopes.length - 1]!.set(stmt.name, index);
      return [{ kind: "LocalSet", index, value }];
    }
    case "Assign": {
      if (stmt.target.kind === "Identifier") {
        const value = lowerExpr(stmt.value, ctx);
        const index = resolveLocal(stmt.target.name, ctx.scopes);
        return [{ kind: "LocalSet", index, value }];
      }
      if (stmt.target.kind === "Index") {
        return lowerIndexedAssign(stmt.target, stmt.value, ctx);
      }
      throw new Error(
        `lower: unsupported assignment target '${stmt.target.kind}'`,
      );
    }
    case "If": {
      const cond = lowerExpr(stmt.cond, ctx);
      const then = lowerBlockStmts(stmt.then, ctx);
      let else_: IRStmt[] | undefined;
      if (stmt.else_) {
        if (stmt.else_.kind === "Block") {
          else_ = lowerBlockStmts(stmt.else_, ctx);
        } else {
          // Chained else-if: lower as nested IfStmt inside the else arm.
          else_ = lowerStmt(stmt.else_, ctx);
        }
      }
      return [{ kind: "IfStmt", cond, then, else_ }];
    }
    case "While": {
      // Canonical lowering:
      //   Block L_exit {
      //     Loop L_head {
      //       BrIf(!c, target: L_exit)
      //       ...body...
      //       Br(target: L_head)
      //     }
      //   }
      const L_exit = 0; // label ids are just markers; relative depth is computed
      const L_head = 1;

      ctx.labelStack.push(L_exit);
      ctx.labelStack.push(L_head);

      const cond = lowerExpr(stmt.cond, ctx);
      const exitDepth = relativeDepth(ctx, L_exit);
      const headDepth = relativeDepth(ctx, L_head);

      const loopBody: IRStmt[] = [
        {
          kind: "BrIf",
          cond: { kind: "UnOp", type: "i32", op: "eqz", operand: cond },
          target: exitDepth,
        },
        ...lowerBlockStmts(stmt.body, ctx),
        { kind: "Br", target: headDepth },
      ];

      ctx.labelStack.pop(); // L_head
      ctx.labelStack.pop(); // L_exit

      return [
        {
          kind: "Block",
          label: L_exit,
          body: [{ kind: "Loop", label: L_head, body: loopBody }],
        },
      ];
    }
    case "Return": {
      if (stmt.value) {
        return [{ kind: "Return", value: lowerExpr(stmt.value, ctx) }];
      }
      return [{ kind: "Return" }];
    }
    case "ExprStmt": {
      // Void calls become CallStmt; everything else is Drop'd.
      if (stmt.expr.kind === "Call") {
        const hasResult = ctx.funcHasResult.get(stmt.expr.callee);
        if (hasResult === undefined) {
          throw new Error(`lower: unknown function '${stmt.expr.callee}'`);
        }
        if (!hasResult) {
          const funcIndex = ctx.funcIndices.get(stmt.expr.callee);
          if (funcIndex === undefined) {
            throw new Error(`lower: unknown function '${stmt.expr.callee}'`);
          }
          const args = stmt.expr.args.map((a) => lowerExpr(a, ctx));
          return [{ kind: "CallStmt", funcIndex, args }];
        }
      }
      return [{ kind: "Drop", value: lowerExpr(stmt.expr, ctx) }];
    }
    case "Block":
      return lowerBlockStmts(stmt, ctx);
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `lower: unhandled statement ${(_exhaustive as TypedStmt).kind}`,
      );
    }
  }
}

/**
 * Lower `arr[i] = value` to:
 *   tmpBase = arr; tmpIdx = i;
 *   if (u32)tmpIdx >= length { unreachable }
 *   store(tmpBase + 4 + tmpIdx*stride, value)
 */
function lowerIndexedAssign(
  target: Extract<TypedExpr, { kind: "Index" }>,
  value: TypedExpr,
  ctx: LowerCtx,
): IRStmt[] {
  const baseType = target.target.type;
  if (baseType.kind !== "array") {
    throw new Error("lower: indexed assign on non-array (should be type error)");
  }

  ctx.module.usesMemory = true;

  const stride = elementStride(baseType);
  const elemWasm = typeToWasm(baseType.element);

  const tmpBase = allocTemp(ctx, "i32");
  const tmpIdx = allocTemp(ctx, "i32");

  const baseExpr = lowerExpr(target.target, ctx);
  const idxExpr = lowerExpr(target.index, ctx);
  const valueExpr = lowerExpr(value, ctx);

  // Address = base + 4 + idx * stride. For constant stride we can use
  // offset on Store when idx is folded, but idx is dynamic — compute addr.
  const addr: IRExpr = {
    kind: "BinOp",
    type: "i32",
    op: "add",
    left: {
      kind: "BinOp",
      type: "i32",
      op: "add",
      left: { kind: "LocalGet", type: "i32", index: tmpBase },
      right: { kind: "Const", type: "i32", value: 4 },
    },
    right: {
      kind: "BinOp",
      type: "i32",
      op: "mul",
      left: { kind: "LocalGet", type: "i32", index: tmpIdx },
      right: { kind: "Const", type: "i32", value: stride },
    },
  };

  return [
    { kind: "LocalSet", index: tmpBase, value: baseExpr },
    { kind: "LocalSet", index: tmpIdx, value: idxExpr },
    {
      kind: "IfStmt",
      cond: {
        kind: "BinOp",
        type: "i32",
        op: "ge_u",
        left: { kind: "LocalGet", type: "i32", index: tmpIdx },
        right: {
          kind: "Load",
          type: "i32",
          addr: { kind: "LocalGet", type: "i32", index: tmpBase },
          offset: 0,
        },
      },
      then: [{ kind: "Unreachable" }],
    },
    {
      kind: "Store",
      addr,
      offset: 0,
      value: valueExpr,
      type: elemWasm,
    },
  ];
}

// ---- Expressions ----

function lowerExpr(expr: TypedExpr, ctx: LowerCtx): IRExpr {
  switch (expr.kind) {
    case "IntLiteral":
      return { kind: "Const", type: "i32", value: expr.value };
    case "BoolLiteral":
      return { kind: "Const", type: "i32", value: expr.value ? 1 : 0 };
    case "FloatLiteral":
      return { kind: "Const", type: "f64", value: expr.value };
    case "Identifier": {
      const index = resolveLocal(expr.name, ctx.scopes);
      return { kind: "LocalGet", type: typeToWasm(expr.type), index };
    }
    case "Unary": {
      const operand = lowerExpr(expr.operand, ctx);
      if (expr.op === "!") {
        return { kind: "UnOp", type: "i32", op: "eqz", operand };
      }
      // Unary minus
      return {
        kind: "UnOp",
        type: typeToWasm(expr.type),
        op: "neg",
        operand,
      };
    }
    case "Binary": {
      const left = lowerExpr(expr.left, ctx);
      const right = lowerExpr(expr.right, ctx);

      if (expr.op === "&&") {
        // Short-circuit: if left then right else 0
        return {
          kind: "IfExpr",
          type: "i32",
          cond: left,
          then: right,
          else_: { kind: "Const", type: "i32", value: 0 },
        };
      }
      if (expr.op === "||") {
        // Short-circuit: if left then 1 else right
        return {
          kind: "IfExpr",
          type: "i32",
          cond: left,
          then: { kind: "Const", type: "i32", value: 1 },
          else_: right,
        };
      }

      const op = binOpToIR(expr.op);
      // For comparisons/equality the IR `type` is the *operand* Wasm type
      // (selects i32.lt_s vs f64.lt); the instruction always yields i32.
      // For arithmetic, type is both operand and result type.
      const isComparison =
        op === "eq" ||
        op === "ne" ||
        op === "lt" ||
        op === "le" ||
        op === "gt" ||
        op === "ge";
      const resultType = isComparison
        ? typeToWasm(expr.left.type)
        : typeToWasm(expr.type);
      return { kind: "BinOp", type: resultType, op, left, right };
    }
    case "Call": {
      const funcIndex = ctx.funcIndices.get(expr.callee);
      if (funcIndex === undefined) {
        throw new Error(`lower: unknown function '${expr.callee}'`);
      }
      const args = expr.args.map((a) => lowerExpr(a, ctx));
      const resultType =
        expr.type.kind === "void" ? "i32" : typeToWasm(expr.type);
      return { kind: "CallExpr", type: resultType, funcIndex, args };
    }
    case "StringLiteral": {
      ctx.module.usesMemory = true;
      const offset = internString(ctx.module.strings, expr.value);
      return { kind: "DataPtr", type: "i32", segmentOffset: offset };
    }
    case "ArrayLiteral":
      return lowerArrayLiteral(expr, ctx);
    case "Index":
      return lowerIndexRead(expr, ctx);
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `lower: unhandled expression ${(_exhaustive as TypedExpr).kind}`,
      );
    }
  }
}

/**
 * Lower `[e0, e1, ...]` to BlockExpr:
 *   tmp = alloc(4 + L*stride)
 *   store length; store each element
 *   result: tmp
 */
function lowerArrayLiteral(
  expr: Extract<TypedExpr, { kind: "ArrayLiteral" }>,
  ctx: LowerCtx,
): IRExpr {
  if (expr.type.kind !== "array") {
    throw new Error("lower: ArrayLiteral without array type");
  }

  ctx.module.usesMemory = true;
  ctx.module.usesAllocator = true;

  const elemType = expr.type.element;
  const stride = elementStride(expr.type);
  const elemWasm = typeToWasm(elemType);
  const length = expr.elements.length;
  const sizeBytes = 4 + length * stride;

  const tmpPtr = allocTemp(ctx, "i32");

  const body: IRStmt[] = [
    {
      kind: "LocalSet",
      index: tmpPtr,
      value: {
        kind: "Alloc",
        type: "i32",
        size: { kind: "Const", type: "i32", value: sizeBytes },
      },
    },
    {
      kind: "Store",
      addr: { kind: "LocalGet", type: "i32", index: tmpPtr },
      offset: 0,
      value: { kind: "Const", type: "i32", value: length },
      type: "i32",
    },
  ];

  for (let i = 0; i < length; i++) {
    body.push({
      kind: "Store",
      addr: { kind: "LocalGet", type: "i32", index: tmpPtr },
      offset: 4 + i * stride,
      value: lowerExpr(expr.elements[i]!, ctx),
      type: elemWasm,
    });
  }

  return {
    kind: "BlockExpr",
    type: "i32",
    body,
    result: { kind: "LocalGet", type: "i32", index: tmpPtr },
  };
}

/**
 * Lower `e[i]` to BlockExpr with bounds check:
 *   tmpBase = e; tmpIdx = i;
 *   if (u32)tmpIdx >= length { unreachable }
 *   result: load(tmpBase + 4 + tmpIdx*stride)
 */
function lowerIndexRead(
  expr: Extract<TypedExpr, { kind: "Index" }>,
  ctx: LowerCtx,
): IRExpr {
  const baseType = expr.target.type;
  if (baseType.kind !== "array" && baseType.kind !== "string") {
    throw new Error(`lower: Index on non-indexable type ${baseType.kind}`);
  }

  ctx.module.usesMemory = true;

  const stride = elementStride(baseType);
  const isString = baseType.kind === "string";
  const resultWasm: WasmType = isString
    ? "i32"
    : typeToWasm(baseType.element);

  const tmpBase = allocTemp(ctx, "i32");
  const tmpIdx = allocTemp(ctx, "i32");

  const body: IRStmt[] = [
    { kind: "LocalSet", index: tmpBase, value: lowerExpr(expr.target, ctx) },
    { kind: "LocalSet", index: tmpIdx, value: lowerExpr(expr.index, ctx) },
    {
      kind: "IfStmt",
      // Unsigned compare: (u32)idx >= length traps for idx < 0 and idx >= len.
      cond: {
        kind: "BinOp",
        type: "i32",
        op: "ge_u",
        left: { kind: "LocalGet", type: "i32", index: tmpIdx },
        right: {
          kind: "Load",
          type: "i32",
          addr: { kind: "LocalGet", type: "i32", index: tmpBase },
          offset: 0,
        },
      },
      then: [{ kind: "Unreachable" }],
    },
  ];

  // Address = base + 4 + idx * stride
  const addr: IRExpr = {
    kind: "BinOp",
    type: "i32",
    op: "add",
    left: {
      kind: "BinOp",
      type: "i32",
      op: "add",
      left: { kind: "LocalGet", type: "i32", index: tmpBase },
      right: { kind: "Const", type: "i32", value: 4 },
    },
    right: {
      kind: "BinOp",
      type: "i32",
      op: "mul",
      left: { kind: "LocalGet", type: "i32", index: tmpIdx },
      right: { kind: "Const", type: "i32", value: stride },
    },
  };

  const result: IRExpr = {
    kind: "Load",
    type: resultWasm,
    addr,
    offset: 0,
    byte: isString ? true : undefined,
  };

  return {
    kind: "BlockExpr",
    type: resultWasm,
    body,
    result,
  };
}

function binOpToIR(op: BinOp): IRBinOp {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "%":
      return "rem";
    case "==":
      return "eq";
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    case "&&":
    case "||":
      // Handled specially in lowerExpr before this is called.
      throw new Error(`lower: ${op} should be desugared to IfExpr`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`lower: unhandled operator '${_exhaustive}'`);
    }
  }
}
