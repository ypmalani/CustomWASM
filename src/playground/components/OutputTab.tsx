interface OutputTabProps {
  lines: string[];
}

export function OutputTab({ lines }: OutputTabProps) {
  if (lines.length === 0) {
    return (
      <div data-testid="output-tab" className="p-4 text-sm text-slate-400">
        Press Run to execute <code className="text-slate-300">main</code>.
      </div>
    );
  }

  return (
    <pre
      data-testid="output-tab"
      className="h-full overflow-auto p-4 font-mono text-sm text-slate-100 whitespace-pre-wrap"
    >
      {lines.join("\n")}
    </pre>
  );
}
