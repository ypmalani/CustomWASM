import { usePlayground } from "../context/PlaygroundContext.js";

export function Editor() {
  const { source, setSource } = usePlayground();

  return (
    <textarea
      aria-label="Source editor"
      spellCheck={false}
      className="h-full w-full resize-none bg-slate-900 p-4 font-mono text-sm text-slate-100 outline-none ring-0 focus:outline-none"
      value={source}
      onChange={(e) => setSource(e.target.value)}
    />
  );
}
