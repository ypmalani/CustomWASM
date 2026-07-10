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
      className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
    >
      {running ? "Running…" : "Run"}
    </button>
  );
}
