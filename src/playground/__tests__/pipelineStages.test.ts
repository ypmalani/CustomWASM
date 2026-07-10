import { describe, expect, it } from "vitest";
import { compile } from "../../compiler/pipeline.js";
import { resolvePipelineState } from "../lib/pipelineStages.js";

describe("resolvePipelineState", () => {
  it("marks all stages complete for a valid program", () => {
    const result = compile("fn main() -> i32 { return 1; }");
    expect(resolvePipelineState(result)).toEqual({
      completedThrough: "emit",
      failedAt: null,
    });
  });

  it("fails at parse for a syntax error", () => {
    const result = compile("fn main() -> i32 { return 1 }");
    const state = resolvePipelineState(result);
    expect(state.failedAt).toBe("parse");
    expect(state.completedThrough).toBe("lex");
  });

  it("fails at check for a type error", () => {
    const result = compile("fn main() -> i32 { return 1 + 1.5; }");
    const state = resolvePipelineState(result);
    expect(state.failedAt).toBe("check");
    expect(state.completedThrough).toBe("parse");
  });
});
