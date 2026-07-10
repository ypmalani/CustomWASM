import wabtFactory from "wabt";
import { makePrintImports } from "../hostImports.js";

export { makePrintImports } from "../hostImports.js";

type WabtModule = Awaited<ReturnType<typeof wabtFactory>>;

let wabt: WabtModule | null = null;

async function getWabt(): Promise<WabtModule> {
  if (!wabt) {
    wabt = await wabtFactory();
  }
  return wabt;
}

export interface WasmExports {
  main: () => number;
  memory?: WebAssembly.Memory;
  [key: string]: unknown;
}

export interface RunWithPrintsResult {
  exports: WasmExports;
  /** Lines captured from env.print_i32 / env.print_str. */
  output: string[];
}

/**
 * Parse WAT text, validate via wat2wasm, instantiate, and return exports.
 * Throws if validation or instantiation fails.
 * No host imports (use compileAndInstantiateWithPrints for Phase 7+).
 */
export async function compileAndInstantiate(wat: string): Promise<WasmExports> {
  const w = await getWabt();
  const module = w.parseWat("test.wat", wat);
  try {
    module.validate();
    const { buffer } = module.toBinary({});
    // Copy into a fresh ArrayBuffer-backed Uint8Array so BufferSource matches
    // the bytes overload of WebAssembly.instantiate (not the Module overload).
    const bytes = Uint8Array.from(buffer);
    const instantiated = await WebAssembly.instantiate(bytes, undefined);
    const instance =
      "instance" in instantiated
        ? (instantiated as WebAssembly.WebAssemblyInstantiatedSource).instance
        : (instantiated as WebAssembly.Instance);
    return instance.exports as unknown as WasmExports;
  } finally {
    module.destroy();
  }
}

/**
 * Like compileAndInstantiate, but supplies env.print_i32 / env.print_str
 * and captures their output. Memory export is wired so print_str can read
 * length-prefixed UTF-8 strings.
 */
export async function compileAndInstantiateWithPrints(
  wat: string,
): Promise<RunWithPrintsResult> {
  const w = await getWabt();
  const module = w.parseWat("test.wat", wat);
  try {
    module.validate();
    const { buffer } = module.toBinary({});
    const bytes = Uint8Array.from(buffer);

    const output: string[] = [];
    let memory: WebAssembly.Memory | undefined;
    const imports = makePrintImports(output, () => memory);

    const instantiated = await WebAssembly.instantiate(bytes, imports);
    const instance =
      "instance" in instantiated
        ? (instantiated as WebAssembly.WebAssemblyInstantiatedSource).instance
        : (instantiated as WebAssembly.Instance);

    memory = instance.exports["memory"] as WebAssembly.Memory | undefined;
    return {
      exports: instance.exports as unknown as WasmExports,
      output,
    };
  } finally {
    module.destroy();
  }
}

/** Validate WAT without instantiating. Throws on failure. */
export async function validateWat(wat: string): Promise<void> {
  const w = await getWabt();
  const module = w.parseWat("test.wat", wat);
  try {
    module.validate();
  } finally {
    module.destroy();
  }
}
