import { describe, expect, it } from "vitest";
import { compile } from "../../compiler/pipeline.js";
import wabtFactory from "wabt";
import { runWasm } from "../lib/runWasm.js";

describe("runWasm smoke", () => {
  it("executes Phase 1 exit-criteria program and returns 14", async () => {
    const source = "fn main() -> i32 { let x = 2 + 3 * 4; return x; }";
    const result = compile(source);
    expect(result.diagnostics).toEqual([]);
    expect(result.wat).not.toBeNull();

    const wabt = await wabtFactory();
    const outcome = await runWasm(wabt, result.wat!);
    expect(outcome).toEqual({ ok: true, value: 14 });
  });
});
