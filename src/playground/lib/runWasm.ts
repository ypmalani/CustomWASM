import type { WabtModule } from "../hooks/useWabt.js";
import { makePrintImports } from "../../compiler/hostImports.js";

export type RunResult =
  | { ok: true; value: number; prints: string[] }
  | { ok: false; error: string };

/**
 * Parse WAT → validate → toBinary → instantiate → call `main()`.
 * Supplies env.print_i32 / env.print_str and captures their output.
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

    const prints: string[] = [];
    let memory: WebAssembly.Memory | undefined;
    const imports = makePrintImports(prints, () => memory);

    const instantiated = await WebAssembly.instantiate(bytes, imports);
    const instance =
      "instance" in instantiated
        ? (instantiated as WebAssembly.WebAssemblyInstantiatedSource).instance
        : (instantiated as WebAssembly.Instance);

    memory = instance.exports["memory"] as WebAssembly.Memory | undefined;

    const main = instance.exports["main"];
    if (typeof main !== "function") {
      return { ok: false, error: 'export "main" is missing or not a function' };
    }
    const value = (main as () => number)();
    return { ok: true, value, prints };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    module?.destroy();
  }
}
