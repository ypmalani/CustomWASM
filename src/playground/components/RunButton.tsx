import { usePlayground } from "../context/PlaygroundContext.js";

export function RunButton() {
  const { result, run, wabt, wabtLoading, wabtError, running } =
    usePlayground();

  const disabled =
    result.wat === null || !wabt || wabtLoading || running || !!wabtError;

  let title = "Run main()";
  if (wabtError) title = `wabt failed: ${wabtError}`;
  else if (wabtLoading) title = "Loading wabt…";
  else if (result.wat === null) title = "Fix errors before running";
  else if (running) title = "Running…";

  return (
    <button
      type="button"
      aria-label="Run"
      title={title}
      disabled={disabled}
      onClick={() => void run()}
      className="rounded bg-signal px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:bg-rule disabled:text-muted disabled:hover:brightness-100"
    >
      {running ? "Running…" : "Run"}
    </button>
  );
}
