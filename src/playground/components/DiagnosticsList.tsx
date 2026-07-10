import type { Diagnostic } from "../../compiler/diagnostics.js";

interface DiagnosticsListProps {
  diagnostics: Diagnostic[];
}

export function DiagnosticsList({ diagnostics }: DiagnosticsListProps) {
  if (diagnostics.length === 0) return null;

  return (
    <ul
      data-testid="diagnostics-list"
      className="space-y-1 border-b border-red-900/50 bg-red-950/40 px-3 py-2 text-sm"
      role="list"
      aria-label="Diagnostics"
    >
      {diagnostics.map((d, i) => (
        <li key={`${d.span.start}-${i}`} className="font-mono text-red-300">
          <span className="text-red-400">
            {d.span.line}:{d.span.col}
          </span>{" "}
          {d.message}
        </li>
      ))}
    </ul>
  );
}
