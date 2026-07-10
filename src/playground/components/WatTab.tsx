interface WatTabProps {
  wat: string | null;
}

export function WatTab({ wat }: WatTabProps) {
  if (wat === null) {
    return (
      <div data-testid="wat-tab" className="p-4 text-sm text-slate-400">
        Fix errors to generate WAT.
      </div>
    );
  }

  return (
    <pre
      data-testid="wat-tab"
      className="h-full overflow-auto p-4 font-mono text-sm text-emerald-200 whitespace-pre"
    >
      {wat}
    </pre>
  );
}
