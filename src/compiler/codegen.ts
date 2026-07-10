/**
 * IR → WAT codegen.
 * Expressions emit post-order onto the stack machine; statements map 1:1
 * onto WASM structured control flow (block/loop/if/br/br_if/return).
 * Locals are referenced by the dense numeric indices already assigned in IR.
 *
 * The IR walk lives in watOps.ts (`compileModule`); this module formats
 * the shared WatOp stream to WAT text. The stepper interprets the same stream.
 */

import type { IRModule } from "./ir.js";
import { compileModule, formatWat } from "./watOps.js";

export { compileModule, formatOp, formatWat } from "./watOps.js";
export type { CompiledFunc, CompiledModule, WatOp } from "./watOps.js";

export function emit(ir: IRModule): string {
  return formatWat(compileModule(ir));
}
