import type { WabtModule } from "../hooks/useWabt.js";

export type RunResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

/**
 * Parse WAT → validate → toBinary → instantiate → call `main()`.
 * No host imports (print_* arrive in Phase 7).
 */
export async function runWasm(
  wabt: WabtModule,
  wat: string,
): Promise<RunResult> {
  let module: ReturnType<WabtModule["parseWat"]> | null = null;
  try {
    module = wabt.parseWat("playground.wat", wat);
    module.validate();
    const { buffer } = module.toBinary({});
    const bytes = Uint8Array.from(buffer);
    const instantiated = await WebAssembly.instantiate(bytes, undefined);
    const instance =
      "instance" in instantiated
        ? (instantiated as WebAssembly.WebAssemblyInstantiatedSource).instance
        : (instantiated as WebAssembly.Instance);

    const main = instance.exports["main"];
    if (typeof main !== "function") {
      return { ok: false, error: 'export "main" is missing or not a function' };
    }
    const value = (main as () => number)();
    return { ok: true, value };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    module?.destroy();
  }
}
