import { Decoration, type DecorationSet } from "@codemirror/view";
import type { Diagnostic } from "../../compiler/diagnostics.js";

/** Absolute character range for a diagnostic underline. */
export interface DiagnosticRange {
  from: number;
  to: number;
  message: string;
  severity: Diagnostic["severity"];
}

/**
 * Map compiler diagnostics to document ranges, clamping to `docLength`
 * and ensuring each range covers at least one character when possible
 * (so zero-width EOF errors still get a visible mark).
 */
export function diagnosticsToRanges(
  diagnostics: Diagnostic[],
  docLength: number,
): DiagnosticRange[] {
  const ranges: DiagnosticRange[] = [];
  for (const d of diagnostics) {
    let from = Math.max(0, Math.min(d.span.start, docLength));
    let to = Math.max(0, Math.min(d.span.end, docLength));
    if (from === to) {
      if (docLength === 0) continue;
      if (from < docLength) to = from + 1;
      else from = Math.max(0, docLength - 1);
    }
    ranges.push({
      from,
      to,
      message: d.message,
      severity: d.severity,
    });
  }
  return ranges;
}

/** Build a CodeMirror Decoration set of wavy underlines from diagnostic ranges. */
export function rangesToDecorations(ranges: DiagnosticRange[]): DecorationSet {
  const marks = ranges.map((r) =>
    Decoration.mark({
      class:
        r.severity === "warning"
          ? "cm-diagnostic-warning"
          : "cm-diagnostic-error",
      attributes: {
        title: r.message,
        "data-testid": "diagnostic-squiggle",
        "data-diagnostic-from": String(r.from),
        "data-diagnostic-to": String(r.to),
        "data-diagnostic-message": r.message,
      },
    }).range(r.from, r.to),
  );
  return Decoration.set(marks, true);
}
