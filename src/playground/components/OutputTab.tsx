interface OutputTabProps {
  lines: string[];
}

export function OutputTab({ lines }: OutputTabProps) {
  if (lines.length === 0) {
    return (
      <div data-testid="output-tab" className="p-4 font-sans text-sm text-muted">
        Press Run to execute <code className="font-mono text-steel">main</code>.
      </div>
    );
  }

  return (
    <pre
      data-testid="output-tab"
      className="h-full overflow-auto bg-ink p-4 font-mono text-sm text-fg whitespace-pre-wrap"
    >
      {lines.join("\n")}
    </pre>
  );
}
