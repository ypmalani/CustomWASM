/**
 * Host import helpers for env.print_i32 / env.print_str.
 * Shared by the test harness and the playground runtime.
 */

/**
 * Build host imports that capture print_* output.
 * print_str reads a length-prefixed UTF-8 string from linear memory.
 */
export function makePrintImports(
  output: string[],
  getMemory: () => WebAssembly.Memory | undefined,
): WebAssembly.Imports {
  return {
    env: {
      print_i32(value: number) {
        output.push(String(value | 0));
      },
      print_str(ptr: number) {
        const memory = getMemory();
        if (!memory) {
          output.push("<print_str: no memory>");
          return;
        }
        const view = new DataView(memory.buffer);
        const len = view.getInt32(ptr, true);
        const bytes = new Uint8Array(memory.buffer, ptr + 4, len);
        output.push(new TextDecoder().decode(bytes));
      },
    },
  };
}
