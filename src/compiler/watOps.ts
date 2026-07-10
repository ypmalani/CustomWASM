/**
 * Shared WAT instruction stream produced by the IR codegen walk.
 * Both `emit()` (format to text) and `trace()` (stepper) consume this —
 * one post-order / structured walk, two sinks.
 */

import type {
  IRBinOp,
  IRExpr,
  IRModule,
  IRStmt,
  WasmType,
} from "./ir.js";

export type WatOp =
  | { kind: "const"; type: WasmType; value: number }
  | { kind: "local.get"; index: number }
  | { kind: "local.set"; index: number }
  | { kind: "binop"; type: WasmType; op: IRBinOp }
  | { kind: "eqz" }
  | { kind: "f64.neg" }
  | { kind: "call"; name: string }
  | { kind: "block"; result?: WasmType }
  | { kind: "loop"; result?: WasmType }
  | { kind: "if"; result?: WasmType }
  | { kind: "else" }
  | { kind: "end" }
  | { kind: "br"; depth: number }
  | { kind: "br_if"; depth: number }
  | { kind: "return" }
  | { kind: "drop" }
  | { kind: "unreachable" }
  | { kind: "load"; type: WasmType; offset: number; byte?: boolean }
  | { kind: "store"; type: WasmType; offset: number; byte?: boolean };

export interface CompiledFunc {
  name: string;
  params: WasmType[];
  locals: WasmType[];
  result?: WasmType;
  exported: boolean;
  ops: WatOp[];
}

export interface CompiledModule {
  imports: IRModule["imports"];
  functions: CompiledFunc[];
  dataSegments: IRModule["dataSegments"];
  memoryPages: number;
  heapBase: number;
  usesMemory: boolean;
  usesAllocator: boolean;
}

/** Lower IR to the shared instruction stream (same walk as historical codegen). */
export function compileModule(ir: IRModule): CompiledModule {
  const funcNames = [
    ...ir.imports.map((i) => i.name),
    ...ir.functions.map((f) => f.name),
  ];

  const functions: CompiledFunc[] = ir.functions.map((fn) => {
    const ops: WatOp[] = [];
    for (const stmt of fn.body) {
      emitStmt(stmt, ops, funcNames);
    }
    return {
      name: fn.name,
      params: fn.params,
      locals: fn.locals,
      result: fn.result,
      exported: fn.exported,
      ops,
    };
  });

  return {
    imports: ir.imports,
    functions,
    dataSegments: ir.dataSegments,
    memoryPages: ir.memoryPages,
    heapBase: ir.heapBase,
    usesMemory: ir.usesMemory,
    usesAllocator: ir.usesAllocator,
  };
}

/** Format a single op as WAT text (no indent). */
export function formatOp(op: WatOp): string {
  switch (op.kind) {
    case "const":
      return `${op.type}.const ${formatConst(op.type, op.value)}`;
    case "local.get":
      return `local.get ${op.index}`;
    case "local.set":
      return `local.set ${op.index}`;
    case "binop":
      return binOpInstr(op.type, op.op);
    case "eqz":
      return "i32.eqz";
    case "f64.neg":
      return "f64.neg";
    case "call":
      return `call $${op.name}`;
    case "block":
      return op.result !== undefined ? `block (result ${op.result})` : "block";
    case "loop":
      return op.result !== undefined ? `loop (result ${op.result})` : "loop";
    case "if":
      return op.result !== undefined ? `if (result ${op.result})` : "if";
    case "else":
      return "else";
    case "end":
      return "end";
    case "br":
      return `br ${op.depth}`;
    case "br_if":
      return `br_if ${op.depth}`;
    case "return":
      return "return";
    case "drop":
      return "drop";
    case "unreachable":
      return "unreachable";
    case "load": {
      const off = op.offset !== 0 ? ` offset=${op.offset}` : "";
      if (op.byte) return `i32.load8_u${off}`;
      return `${op.type}.load${off}`;
    }
    case "store": {
      const off = op.offset !== 0 ? ` offset=${op.offset}` : "";
      if (op.byte) return `i32.store8${off}`;
      return `${op.type}.store${off}`;
    }
    default: {
      const _exhaustive: never = op;
      throw new Error(
        `formatOp: unhandled ${(_exhaustive as WatOp).kind}`,
      );
    }
  }
}

/** Format a compiled module as WAT text (stable indentation matching prior emit). */
export function formatWat(mod: CompiledModule): string {
  const lines: string[] = [];
  lines.push("(module");

  for (const imp of mod.imports) {
    const params = imp.params.map((t) => ` (param ${t})`).join("");
    const result = imp.result ? ` (result ${imp.result})` : "";
    lines.push(
      `  (import "${imp.module}" "${imp.name}" (func $${imp.name}${params}${result}))`,
    );
  }

  if (mod.usesMemory) {
    lines.push(`  (memory (export "memory") ${mod.memoryPages})`);
    for (const seg of mod.dataSegments) {
      lines.push(
        `  (data (i32.const ${seg.offset}) "${escapeDataBytes(seg.bytes)}")`,
      );
    }
  }

  if (mod.usesAllocator) {
    lines.push(`  (global $hp (mut i32) (i32.const ${mod.heapBase}))`);
    emitAllocHelper(lines);
  }

  for (const fn of mod.functions) {
    formatFunction(fn, lines, 1);
  }

  lines.push(")");
  return lines.join("\n") + "\n";
}

export function formatConst(type: WasmType, value: number): string {
  if (type === "i32") {
    return String(value);
  }
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

export function binOpInstr(type: WasmType, op: IRBinOp): string {
  const prefix = type;
  switch (op) {
    case "add":
      return `${prefix}.add`;
    case "sub":
      return `${prefix}.sub`;
    case "mul":
      return `${prefix}.mul`;
    case "div":
      return type === "i32" ? "i32.div_s" : "f64.div";
    case "rem":
      return "i32.rem_s";
    case "eq":
      return `${prefix}.eq`;
    case "ne":
      return `${prefix}.ne`;
    case "lt":
      return type === "i32" ? "i32.lt_s" : "f64.lt";
    case "le":
      return type === "i32" ? "i32.le_s" : "f64.le";
    case "gt":
      return type === "i32" ? "i32.gt_s" : "f64.gt";
    case "ge":
      return type === "i32" ? "i32.ge_s" : "f64.ge";
    case "ge_u":
      return "i32.ge_u";
    case "and":
      return "i32.and";
    case "or":
      return "i32.or";
    default: {
      const _exhaustive: never = op;
      throw new Error(`codegen: unhandled binop '${_exhaustive}'`);
    }
  }
}

// ---- IR walk (shared with historical codegen structure) ----

export function emitStmt(
  stmt: IRStmt,
  out: WatOp[],
  funcNames: string[],
): void {
  switch (stmt.kind) {
    case "Block": {
      out.push({ kind: "block" });
      for (const s of stmt.body) {
        emitStmt(s, out, funcNames);
      }
      out.push({ kind: "end" });
      break;
    }
    case "Loop": {
      out.push({ kind: "loop" });
      for (const s of stmt.body) {
        emitStmt(s, out, funcNames);
      }
      out.push({ kind: "end" });
      break;
    }
    case "IfStmt": {
      emitExpr(stmt.cond, out, funcNames);
      out.push({ kind: "if" });
      for (const s of stmt.then) {
        emitStmt(s, out, funcNames);
      }
      if (stmt.else_) {
        out.push({ kind: "else" });
        for (const s of stmt.else_) {
          emitStmt(s, out, funcNames);
        }
      }
      out.push({ kind: "end" });
      break;
    }
    case "Br": {
      out.push({ kind: "br", depth: stmt.target });
      break;
    }
    case "BrIf": {
      emitExpr(stmt.cond, out, funcNames);
      out.push({ kind: "br_if", depth: stmt.target });
      break;
    }
    case "LocalSet": {
      emitExpr(stmt.value, out, funcNames);
      out.push({ kind: "local.set", index: stmt.index });
      break;
    }
    case "Store": {
      emitExpr(stmt.addr, out, funcNames);
      emitExpr(stmt.value, out, funcNames);
      out.push({
        kind: "store",
        type: stmt.type,
        offset: stmt.offset,
        byte: stmt.byte,
      });
      break;
    }
    case "CallStmt": {
      for (const arg of stmt.args) {
        emitExpr(arg, out, funcNames);
      }
      const name = funcNames[stmt.funcIndex];
      if (name === undefined) {
        throw new Error(`codegen: invalid funcIndex ${stmt.funcIndex}`);
      }
      out.push({ kind: "call", name });
      break;
    }
    case "Drop": {
      emitExpr(stmt.value, out, funcNames);
      out.push({ kind: "drop" });
      break;
    }
    case "Return": {
      if (stmt.value) {
        emitExpr(stmt.value, out, funcNames);
      }
      out.push({ kind: "return" });
      break;
    }
    case "Unreachable": {
      out.push({ kind: "unreachable" });
      break;
    }
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `codegen: unhandled statement ${(_exhaustive as IRStmt).kind}`,
      );
    }
  }
}

export function emitExpr(
  expr: IRExpr,
  out: WatOp[],
  funcNames: string[],
): void {
  switch (expr.kind) {
    case "Const": {
      out.push({ kind: "const", type: expr.type, value: expr.value });
      break;
    }
    case "LocalGet": {
      out.push({ kind: "local.get", index: expr.index });
      break;
    }
    case "BinOp": {
      emitExpr(expr.left, out, funcNames);
      emitExpr(expr.right, out, funcNames);
      out.push({ kind: "binop", type: expr.type, op: expr.op });
      break;
    }
    case "UnOp": {
      if (expr.op === "eqz") {
        emitExpr(expr.operand, out, funcNames);
        out.push({ kind: "eqz" });
      } else if (expr.type === "i32") {
        out.push({ kind: "const", type: "i32", value: 0 });
        emitExpr(expr.operand, out, funcNames);
        out.push({ kind: "binop", type: "i32", op: "sub" });
      } else {
        emitExpr(expr.operand, out, funcNames);
        out.push({ kind: "f64.neg" });
      }
      break;
    }
    case "CallExpr": {
      for (const arg of expr.args) {
        emitExpr(arg, out, funcNames);
      }
      const name = funcNames[expr.funcIndex];
      if (name === undefined) {
        throw new Error(`codegen: invalid funcIndex ${expr.funcIndex}`);
      }
      out.push({ kind: "call", name });
      break;
    }
    case "IfExpr": {
      emitExpr(expr.cond, out, funcNames);
      out.push({ kind: "if", result: expr.type });
      emitExpr(expr.then, out, funcNames);
      out.push({ kind: "else" });
      emitExpr(expr.else_, out, funcNames);
      out.push({ kind: "end" });
      break;
    }
    case "Load": {
      emitExpr(expr.addr, out, funcNames);
      out.push({
        kind: "load",
        type: expr.type,
        offset: expr.offset,
        byte: expr.byte,
      });
      break;
    }
    case "DataPtr": {
      out.push({ kind: "const", type: "i32", value: expr.segmentOffset });
      break;
    }
    case "Alloc": {
      emitExpr(expr.size, out, funcNames);
      out.push({ kind: "call", name: "alloc" });
      break;
    }
    case "BlockExpr": {
      out.push({ kind: "block", result: expr.type });
      for (const s of expr.body) {
        emitStmt(s, out, funcNames);
      }
      emitExpr(expr.result, out, funcNames);
      out.push({ kind: "end" });
      break;
    }
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `codegen: unhandled expression ${(_exhaustive as IRExpr).kind}`,
      );
    }
  }
}

// ---- formatting helpers ----

function indent(level: number): string {
  return "  ".repeat(level);
}

function formatFunction(
  fn: CompiledFunc,
  lines: string[],
  level: number,
): void {
  const exportPart = fn.exported ? ` (export "${fn.name}")` : "";
  const paramPart = fn.params.map((t) => ` (param ${t})`).join("");
  const resultPart = fn.result ? ` (result ${fn.result})` : "";
  const localsPart = fn.locals.map((t) => ` (local ${t})`).join("");

  lines.push(
    `${indent(level)}(func $${fn.name}${exportPart}${paramPart}${resultPart}${localsPart}`,
  );

  let depth = level + 1;
  for (const op of fn.ops) {
    if (op.kind === "else" || op.kind === "end") {
      depth -= 1;
    }
    lines.push(`${indent(depth)}${formatOp(op)}`);
    if (op.kind === "block" || op.kind === "loop" || op.kind === "if") {
      depth += 1;
    } else if (op.kind === "else") {
      depth += 1;
    }
  }

  lines.push(`${indent(level)})`);
}

function emitAllocHelper(lines: string[]): void {
  lines.push(
    `  (func $alloc (param $n i32) (result i32) (local $ptr i32) (local $aligned i32)`,
  );
  lines.push(`    global.get $hp`);
  lines.push(`    local.set $ptr`);
  lines.push(`    local.get $n`);
  lines.push(`    i32.const 7`);
  lines.push(`    i32.add`);
  lines.push(`    i32.const -8`);
  lines.push(`    i32.and`);
  lines.push(`    local.set $aligned`);
  lines.push(`    local.get $ptr`);
  lines.push(`    local.get $aligned`);
  lines.push(`    i32.add`);
  lines.push(`    global.set $hp`);
  lines.push(`    block $grow_done`);
  lines.push(`      loop $grow`);
  lines.push(`        global.get $hp`);
  lines.push(`        memory.size`);
  lines.push(`        i32.const 65536`);
  lines.push(`        i32.mul`);
  lines.push(`        i32.le_u`);
  lines.push(`        br_if $grow_done`);
  lines.push(`        i32.const 1`);
  lines.push(`        memory.grow`);
  lines.push(`        i32.const -1`);
  lines.push(`        i32.eq`);
  lines.push(`        if`);
  lines.push(`          unreachable`);
  lines.push(`        end`);
  lines.push(`        br $grow`);
  lines.push(`      end`);
  lines.push(`    end`);
  lines.push(`    local.get $ptr`);
  lines.push(`  )`);
}

function escapeDataBytes(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    if (b >= 0x20 && b <= 0x7e && b !== 0x22 && b !== 0x5c) {
      out += String.fromCharCode(b);
    } else {
      out += "\\" + b.toString(16).padStart(2, "0").toUpperCase();
    }
  }
  return out;
}
