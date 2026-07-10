import { describe, expect, it } from "vitest";
import { compile } from "../../compiler/pipeline.js";
import {
  diagnosticsToRanges,
  rangesToDecorations,
} from "../lib/diagnosticDecorations.js";

describe("diagnosticsToRanges", () => {
  it("maps parse-error span to the unexpected token (Phase 1)", () => {
    const src = "fn main() -> i32 { let x = 1 return x; }";
    const { diagnostics } = compile(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    const ranges = diagnosticsToRanges(diagnostics, src.length);
    const first = ranges[0]!;
    expect(src.slice(first.from, first.to)).toBe("return");
    expect(first.message).toBe("expected ';', found 'return'");
  });

  it("maps type-error span for i32 + f64 (Phase 4)", () => {
    const src = "fn main() -> i32 { return 1 + 1.5; }";
    const { diagnostics } = compile(src);
    expect(diagnostics).toHaveLength(1);
    const ranges = diagnosticsToRanges(diagnostics, src.length);
    expect(ranges).toHaveLength(1);
    expect(src.slice(ranges[0]!.from, ranges[0]!.to)).toBe("1 + 1.5");
    expect(ranges[0]!.message).toContain("same numeric type");
  });

  it("maps undefined-variable span (Phase 4)", () => {
    const src = "fn main() -> i32 { return x; }";
    const { diagnostics } = compile(src);
    expect(diagnostics).toHaveLength(1);
    const ranges = diagnosticsToRanges(diagnostics, src.length);
    expect(src.slice(ranges[0]!.from, ranges[0]!.to)).toBe("x");
    expect(ranges[0]!.message).toBe("undefined variable 'x'");
  });

  it("clamps ranges to document length", () => {
    const ranges = diagnosticsToRanges(
      [
        {
          message: "boom",
          span: { start: 0, end: 100, line: 1, col: 1 },
          severity: "error",
        },
      ],
      5,
    );
    expect(ranges[0]).toMatchObject({ from: 0, to: 5 });
  });

  it("builds a non-empty Decoration set", () => {
    const deco = rangesToDecorations([
      {
        from: 0,
        to: 3,
        message: "expected ';', found 'return'",
        severity: "error",
      },
    ]);
    expect(deco.size).toBe(1);
  });
});
