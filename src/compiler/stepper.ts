/**
 * Stack-machine stepper: interprets the same WatOp[] stream that codegen
 * formats to WAT. Observation-only — does not change compiler output.
 */

import type { Span } from "./token.js";
import type { IRBinOp, IRModule, WasmType } from "./ir.js";
import {
  type CompiledFunc,
  type CompiledModule,
  type WatOp,
  compileModule,
  formatOp,
} from "./watOps.js";

export type StackValue = { type: "i32" | "f64"; bits: number };

export interface Step {
  instruction: string;
  opIndex: number;
  funcName: string;
  stack: StackValue[];
  locals: StackValue[];
  sourceSpan?: Span;
}

export interface TraceResult {
  steps: Step[];
  returnValue: number | undefined;
  prints: string[];
  trapped: boolean;
}

const PAGE_SIZE = 65536;
const MAX_STEPS = 1_000_000;

interface ControlLabel {
  kind: "block" | "loop" | "if";
  startIndex: number;
  endIndex: number;
  elseIndex?: number;
  result?: WasmType;
  stackHeight: number;
}

interface FuncControl {
  /** opener index → end index */
  endOf: Map<number, number>;
  /** if opener index → else index (if present) */
  elseOf: Map<number, number>;
}

interface Frame {
  func: CompiledFunc;
  pc: number;
  locals: StackValue[];
  labels: ControlLabel[];
  control: FuncControl;
  /** Operand-stack height after args were consumed (for return unwind). */
  entryStackHeight: number;
}

/**
 * Compile IR and run `main`, recording a Step after every executed instruction.
 */
export function trace(ir: IRModule): TraceResult {
  return interpret(compileModule(ir));
}

export function interpret(mod: CompiledModule): TraceResult {
  const steps: Step[] = [];
  const prints: string[] = [];
  let trapped = false;
  let returnValue: number | undefined;

  const funcByName = new Map<string, CompiledFunc>();
  for (const fn of mod.functions) {
    funcByName.set(fn.name, fn);
  }

  const main = funcByName.get("main");
  if (!main) {
    return { steps, returnValue: undefined, prints, trapped: true };
  }

  const controlCache = new Map<CompiledFunc, FuncControl>();
  function getControl(fn: CompiledFunc): FuncControl {
    let c = controlCache.get(fn);
    if (!c) {
      c = buildControl(fn.ops);
      controlCache.set(fn, c);
    }
    return c;
  }

  let memory = new Uint8Array(
    (mod.usesMemory ? mod.memoryPages : 0) * PAGE_SIZE,
  );
  for (const seg of mod.dataSegments) {
    memory.set(seg.bytes, seg.offset);
  }
  let hp = mod.heapBase | 0;
  let memoryPages = mod.usesMemory ? mod.memoryPages : 0;

  const stack: StackValue[] = [];
  const frames: Frame[] = [];

  function pushFrame(func: CompiledFunc, args: StackValue[]): void {
    const localTypes = [...func.params, ...func.locals];
    const locals: StackValue[] = localTypes.map((t, i) => {
      if (i < args.length) {
        const a = args[i]!;
        return { type: t, bits: t === "i32" ? a.bits | 0 : a.bits };
      }
      return { type: t, bits: 0 };
    });
    frames.push({
      func,
      pc: 0,
      locals,
      labels: [],
      control: getControl(func),
      entryStackHeight: stack.length,
    });
  }

  function snapshot(instruction: string, opIndex: number, funcName: string): void {
    const frame = frames[frames.length - 1];
    steps.push({
      instruction,
      opIndex,
      funcName,
      stack: stack.map((v) => ({ ...v })),
      locals: frame
        ? frame.locals.map((v) => ({ ...v }))
        : [],
    });
  }

  function pop(): StackValue {
    const v = stack.pop();
    if (!v) throw new Error("stepper: stack underflow");
    return v;
  }

  function pushI32(n: number): void {
    stack.push({ type: "i32", bits: n | 0 });
  }

  function pushF64(n: number): void {
    stack.push({ type: "f64", bits: n });
  }

  function pushVal(type: WasmType, n: number): void {
    if (type === "i32") pushI32(n);
    else pushF64(n);
  }

  function doAlloc(nBytes: number): number {
    const aligned = ((nBytes | 0) + 7) & ~7;
    const ptr = hp;
    hp = (hp + aligned) | 0;
    while (hp > memoryPages * PAGE_SIZE) {
      // memory.grow 1
      const next = new Uint8Array((memoryPages + 1) * PAGE_SIZE);
      next.set(memory);
      memory = next;
      memoryPages += 1;
      if (memoryPages > 1024) {
        trapped = true;
        return 0;
      }
    }
    return ptr;
  }

  function readI32(addr: number): number {
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    return view.getInt32(addr, true);
  }

  function writeI32(addr: number, value: number): void {
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    view.setInt32(addr, value | 0, true);
  }

  function readF64(addr: number): number {
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    return view.getFloat64(addr, true);
  }

  function writeF64(addr: number, value: number): void {
    const view = new DataView(memory.buffer, memory.byteOffset, memory.byteLength);
    view.setFloat64(addr, value, true);
  }

  function callBuiltin(name: string): boolean {
    if (name === "alloc") {
      const n = pop();
      const ptr = doAlloc(n.bits | 0);
      if (trapped) return true;
      pushI32(ptr);
      return true;
    }
    if (name === "print_i32") {
      const v = pop();
      prints.push(String(v.bits | 0));
      return true;
    }
    if (name === "print_str") {
      const ptr = pop().bits | 0;
      if (memory.length === 0) {
        prints.push("<print_str: no memory>");
        return true;
      }
      const len = readI32(ptr);
      const bytes = memory.subarray(ptr + 4, ptr + 4 + len);
      prints.push(new TextDecoder().decode(bytes));
      return true;
    }
    return false;
  }

  function doBr(depth: number, frame: Frame): number {
    const targetIdx = frame.labels.length - 1 - depth;
    if (targetIdx < 0) throw new Error(`stepper: invalid br depth ${depth}`);
    const target = frame.labels[targetIdx]!;
    let result: StackValue | undefined;
    if (target.result !== undefined) {
      result = pop();
    }
    stack.length = target.stackHeight;
    if (result !== undefined) {
      stack.push(result);
    }
    // Pop nested labels; keep the target for loops (re-enter), drop it for block/if (exit).
    frame.labels.length = targetIdx + 1;
    if (target.kind === "loop") {
      return target.startIndex + 1;
    }
    frame.labels.pop();
    return target.endIndex + 1;
  }

  pushFrame(main, []);

  let stepCount = 0;
  while (frames.length > 0) {
    if (trapped || stepCount++ > MAX_STEPS) {
      trapped = true;
      break;
    }

    const frame = frames[frames.length - 1]!;
    const { func, control } = frame;

    if (frame.pc >= func.ops.length) {
      // Implicit return (void or fall-through)
      const resultTy = func.result;
      let result: StackValue | undefined;
      if (resultTy !== undefined) {
        result = pop();
      }
      stack.length = frame.entryStackHeight;
      frames.pop();
      if (frames.length === 0) {
        if (result) returnValue = result.bits;
        break;
      }
      if (result) stack.push(result);
      snapshot("return", -1, func.name);
      continue;
    }

    const opIndex = frame.pc;
    const op = func.ops[opIndex]!;
    const instr = formatOp(op);
    let nextPc = opIndex + 1;

    try {
      switch (op.kind) {
        case "const": {
          pushVal(op.type, op.value);
          break;
        }
        case "local.get": {
          const loc = frame.locals[op.index];
          if (!loc) throw new Error(`stepper: bad local.get ${op.index}`);
          stack.push({ ...loc });
          break;
        }
        case "local.set": {
          const v = pop();
          const ty = frame.locals[op.index]?.type ?? "i32";
          frame.locals[op.index] = {
            type: ty,
            bits: ty === "i32" ? v.bits | 0 : v.bits,
          };
          break;
        }
        case "binop": {
          const right = pop();
          const left = pop();
          stack.push(evalBinOp(op.type, op.op, left, right));
          break;
        }
        case "eqz": {
          const v = pop();
          pushI32((v.bits | 0) === 0 ? 1 : 0);
          break;
        }
        case "f64.neg": {
          const v = pop();
          pushF64(-v.bits);
          break;
        }
        case "drop": {
          pop();
          break;
        }
        case "unreachable": {
          trapped = true;
          snapshot(instr, opIndex, func.name);
          frames.length = 0;
          continue;
        }
        case "block": {
          const endIndex = control.endOf.get(opIndex);
          if (endIndex === undefined) {
            throw new Error("stepper: block missing end");
          }
          frame.labels.push({
            kind: "block",
            startIndex: opIndex,
            endIndex,
            result: op.result,
            stackHeight: stack.length,
          });
          break;
        }
        case "loop": {
          const endIndex = control.endOf.get(opIndex);
          if (endIndex === undefined) {
            throw new Error("stepper: loop missing end");
          }
          frame.labels.push({
            kind: "loop",
            startIndex: opIndex,
            endIndex,
            result: op.result,
            stackHeight: stack.length,
          });
          break;
        }
        case "if": {
          const cond = pop();
          const endIndex = control.endOf.get(opIndex);
          if (endIndex === undefined) {
            throw new Error("stepper: if missing end");
          }
          const elseIndex = control.elseOf.get(opIndex);
          if ((cond.bits | 0) !== 0) {
            frame.labels.push({
              kind: "if",
              startIndex: opIndex,
              endIndex,
              elseIndex,
              result: op.result,
              stackHeight: stack.length,
            });
          } else if (elseIndex !== undefined) {
            frame.labels.push({
              kind: "if",
              startIndex: opIndex,
              endIndex,
              elseIndex,
              result: op.result,
              stackHeight: stack.length,
            });
            // Skip the `else` marker; land on first else-body op
            nextPc = elseIndex + 1;
          } else {
            // Skip whole if including end
            nextPc = endIndex + 1;
          }
          break;
        }
        case "else": {
          // Fall-through from then-arm: skip else body → end
          const label = frame.labels[frame.labels.length - 1];
          if (!label || label.kind !== "if") {
            throw new Error("stepper: else without if");
          }
          nextPc = label.endIndex;
          break;
        }
        case "end": {
          frame.labels.pop();
          break;
        }
        case "br": {
          nextPc = doBr(op.depth, frame);
          break;
        }
        case "br_if": {
          const cond = pop();
          if ((cond.bits | 0) !== 0) {
            nextPc = doBr(op.depth, frame);
          }
          break;
        }
        case "return": {
          const resultTy = func.result;
          let result: StackValue | undefined;
          if (resultTy !== undefined) {
            result = pop();
          }
          stack.length = frame.entryStackHeight;
          frames.pop();
          if (frames.length === 0) {
            if (result) returnValue = result.bits;
            snapshot(instr, opIndex, func.name);
            continue;
          }
          if (result) stack.push(result);
          snapshot(instr, opIndex, func.name);
          continue;
        }
        case "call": {
          if (callBuiltin(op.name)) {
            if (trapped) {
              snapshot(instr, opIndex, func.name);
              frames.length = 0;
              continue;
            }
            break;
          }
          const callee = funcByName.get(op.name);
          if (!callee) {
            throw new Error(`stepper: unknown function $${op.name}`);
          }
          const args: StackValue[] = [];
          for (let i = 0; i < callee.params.length; i++) {
            args.unshift(pop());
          }
          snapshot(instr, opIndex, func.name);
          frame.pc = opIndex + 1;
          pushFrame(callee, args);
          continue;
        }
        case "load": {
          const addr = (pop().bits | 0) + (op.offset | 0);
          if (op.byte) {
            pushI32(memory[addr] ?? 0);
          } else if (op.type === "i32") {
            pushI32(readI32(addr));
          } else {
            pushF64(readF64(addr));
          }
          break;
        }
        case "store": {
          const value = pop();
          const addr = (pop().bits | 0) + (op.offset | 0);
          if (op.byte) {
            memory[addr] = value.bits & 0xff;
          } else if (op.type === "i32") {
            writeI32(addr, value.bits);
          } else {
            writeF64(addr, value.bits);
          }
          break;
        }
        default: {
          const _exhaustive: never = op;
          throw new Error(
            `stepper: unhandled op ${(_exhaustive as WatOp).kind}`,
          );
        }
      }
    } catch {
      // WASM traps (div/0, etc.) or interpreter errors
      trapped = true;
      snapshot(instr, opIndex, func.name);
      break;
    }

    snapshot(instr, opIndex, func.name);
    frame.pc = nextPc;
  }

  return { steps, returnValue, prints, trapped };
}

function buildControl(ops: WatOp[]): FuncControl {
  const endOf = new Map<number, number>();
  const elseOf = new Map<number, number>();
  const stack: number[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    if (op.kind === "block" || op.kind === "loop" || op.kind === "if") {
      stack.push(i);
    } else if (op.kind === "else") {
      const opener = stack[stack.length - 1];
      if (opener === undefined) throw new Error("watOps: else without if");
      elseOf.set(opener, i);
    } else if (op.kind === "end") {
      const opener = stack.pop();
      if (opener === undefined) throw new Error("watOps: end without opener");
      endOf.set(opener, i);
    }
  }
  if (stack.length !== 0) throw new Error("watOps: unclosed control");
  return { endOf, elseOf };
}

function evalBinOp(
  type: WasmType,
  op: IRBinOp,
  left: StackValue,
  right: StackValue,
): StackValue {
  if (type === "i32" || op === "and" || op === "or" || op === "ge_u") {
    const a = left.bits | 0;
    const b = right.bits | 0;
    switch (op) {
      case "add":
        return { type: "i32", bits: (a + b) | 0 };
      case "sub":
        return { type: "i32", bits: (a - b) | 0 };
      case "mul":
        return { type: "i32", bits: Math.imul(a, b) };
      case "div": {
        if (b === 0) throw new Error("div_s by zero");
        if (a === -2147483648 && b === -1) throw new Error("div_s overflow");
        return { type: "i32", bits: (a / b) | 0 };
      }
      case "rem": {
        if (b === 0) throw new Error("rem_s by zero");
        return { type: "i32", bits: a % b | 0 };
      }
      case "eq":
        return { type: "i32", bits: a === b ? 1 : 0 };
      case "ne":
        return { type: "i32", bits: a !== b ? 1 : 0 };
      case "lt":
        return { type: "i32", bits: a < b ? 1 : 0 };
      case "le":
        return { type: "i32", bits: a <= b ? 1 : 0 };
      case "gt":
        return { type: "i32", bits: a > b ? 1 : 0 };
      case "ge":
        return { type: "i32", bits: a >= b ? 1 : 0 };
      case "ge_u":
        return {
          type: "i32",
          bits: (a >>> 0) >= (b >>> 0) ? 1 : 0,
        };
      case "and":
        return { type: "i32", bits: a & b };
      case "or":
        return { type: "i32", bits: a | b };
      default: {
        const _exhaustive: never = op;
        throw new Error(`stepper: bad i32 op ${_exhaustive}`);
      }
    }
  }

  // f64 arithmetic / compare (compare still leaves i32)
  const a = left.bits;
  const b = right.bits;
  switch (op) {
    case "add":
      return { type: "f64", bits: a + b };
    case "sub":
      return { type: "f64", bits: a - b };
    case "mul":
      return { type: "f64", bits: a * b };
    case "div":
      return { type: "f64", bits: a / b };
    case "eq":
      return { type: "i32", bits: a === b ? 1 : 0 };
    case "ne":
      return { type: "i32", bits: a !== b ? 1 : 0 };
    case "lt":
      return { type: "i32", bits: a < b ? 1 : 0 };
    case "le":
      return { type: "i32", bits: a <= b ? 1 : 0 };
    case "gt":
      return { type: "i32", bits: a > b ? 1 : 0 };
    case "ge":
      return { type: "i32", bits: a >= b ? 1 : 0 };
    default:
      throw new Error(`stepper: bad f64 op ${op}`);
  }
}

export { formatOp };
