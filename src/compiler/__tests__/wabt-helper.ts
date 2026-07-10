import wabtFactory from "wabt";

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
  [key: string]: unknown;
}

/**
 * Parse WAT text, validate via wat2wasm, instantiate, and return exports.
 * Throws if validation or instantiation fails.
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
