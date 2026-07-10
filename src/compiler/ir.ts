/**
 * Tree-structured Intermediate Representation.
 * Statements are structured control-flow nodes mirroring WASM exactly;
 * expressions remain typed trees emitted post-order onto the stack machine.
 * Names are gone — all variables are dense per-function local indices.
 */

export type WasmType = "i32" | "f64"; // bool and pointers lower to i32

export type IRBinOp =
  | "add"
  | "sub"
  | "mul"
  | "div"
  | "rem"
  | "eq"
  | "ne"
  | "lt"
  | "le"
  | "gt"
  | "ge"
  | "ge_u" // unsigned ≥ — used for bounds checks (traps on negative indices)
  | "and"
  | "or";

export type IRExpr =
  | { kind: "Const"; type: WasmType; value: number }
  | { kind: "LocalGet"; type: WasmType; index: number }
  | { kind: "BinOp"; type: WasmType; op: IRBinOp; left: IRExpr; right: IRExpr }
  | { kind: "UnOp"; type: WasmType; op: "eqz" | "neg"; operand: IRExpr }
  | { kind: "CallExpr"; type: WasmType; funcIndex: number; args: IRExpr[] }
  | {
      kind: "Load";
      type: WasmType;
      addr: IRExpr;
      offset: number;
      /** When true, emit i32.load8_u (string byte / codepoint). */
      byte?: boolean;
    }
  | { kind: "DataPtr"; type: "i32"; segmentOffset: number }
  /** Value-producing conditional; emits WASM `if (result T)`. Used for short-circuit &&/||. */
  | {
      kind: "IfExpr";
      type: WasmType;
      cond: IRExpr;
      then: IRExpr;
      else_: IRExpr;
    }
  /** Bump-allocator intrinsic; emits `call $alloc`. Size is in bytes. */
  | { kind: "Alloc"; type: "i32"; size: IRExpr }
  /**
   * Value-producing block; emits WASM `block (result T)`.
   * Body statements run for side effects; `result` is left on the stack.
   * Used for array construction and bounds-checked indexing.
   */
  | {
      kind: "BlockExpr";
      type: WasmType;
      body: IRStmt[];
      result: IRExpr;
    };

export type IRStmt =
  // Structured control flow — 1:1 with WASM constructs.
  | { kind: "Block"; label: number; body: IRStmt[] }
  | { kind: "Loop"; label: number; body: IRStmt[] }
  | { kind: "IfStmt"; cond: IRExpr; then: IRStmt[]; else_?: IRStmt[] }
  | { kind: "Br"; target: number }
  | { kind: "BrIf"; cond: IRExpr; target: number }
  // Effects
  | { kind: "LocalSet"; index: number; value: IRExpr }
  | {
      kind: "Store";
      addr: IRExpr;
      offset: number;
      value: IRExpr;
      type: WasmType;
      /** When true, emit i32.store8. */
      byte?: boolean;
    }
  | { kind: "CallStmt"; funcIndex: number; args: IRExpr[] }
  | { kind: "Drop"; value: IRExpr }
  | { kind: "Return"; value?: IRExpr }
  | { kind: "Unreachable" };

export interface IRFunction {
  name: string;
  params: WasmType[];
  /** Indices continue after params. */
  locals: WasmType[];
  result?: WasmType;
  body: IRStmt[];
  exported: boolean;
}

export interface IRModule {
  functions: IRFunction[];
  imports: {
    module: string;
    name: string;
    params: WasmType[];
    result?: WasmType;
  }[];
  dataSegments: { offset: number; bytes: Uint8Array }[];
  memoryPages: number;
  heapBase: number;
  /** True when the module needs linear memory (strings, arrays, or prints). */
  usesMemory: boolean;
  /** True when the module needs the bump allocator ($hp + $alloc). */
  usesAllocator: boolean;
}
