import type { Diagnostic } from "../../compiler/diagnostics.js";

interface DiagnosticsListProps {
  diagnostics: Diagnostic[];
}

export function DiagnosticsList({ diagnostics }: DiagnosticsListProps) {
  if (diagnostics.length === 0) return null;

  return (
    <ul
      data-testid="diagnostics-list"
      className="space-y-1 border-b border-error/30 bg-error/10 px-3 py-2 text-sm"
      role="list"
      aria-label="Diagnostics"
    >
      {diagnostics.map((d, i) => (
        <li
          key={`${d.span.start}-${i}`}
          tabIndex={0}
          className="rounded px-1 font-mono text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
        >
          <span className="text-copper">
            {d.span.line}:{d.span.col}
          </span>{" "}
          <span className="text-fg/90">{d.message}</span>
        </li>
      ))}
    </ul>
  );
}
