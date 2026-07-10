interface WatTabProps {
  wat: string | null;
}

export function WatTab({ wat }: WatTabProps) {
  if (wat === null) {
    return (
      <div data-testid="wat-tab" className="p-4 font-sans text-sm text-muted">
        Fix errors to generate WAT.
      </div>
    );
  }

  return (
    <pre
      data-testid="wat-tab"
      className="h-full overflow-auto bg-ink p-4 font-mono text-sm text-signal whitespace-pre"
    >
      {wat}
    </pre>
  );
}
