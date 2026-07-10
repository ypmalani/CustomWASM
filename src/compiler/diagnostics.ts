import type { Span } from "./token.js";

export type Severity = "error" | "warning";

export interface Diagnostic {
  message: string;
  span: Span;
  severity: Severity;
}
