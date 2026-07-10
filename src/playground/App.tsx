import { Editor } from "./components/Editor.js";
import { Inspector } from "./components/Inspector.js";
import { RunButton } from "./components/RunButton.js";

export function App() {
  return (
    <div className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-2">
        <h1 className="text-sm font-semibold tracking-wide text-slate-200">
          CustomWASM Playground
        </h1>
        <RunButton />
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-2">
        <section
          aria-label="Source"
          className="min-h-0 border-r border-slate-800"
        >
          <Editor />
        </section>
        <section aria-label="Inspector" className="min-h-0">
          <Inspector />
        </section>
      </div>
    </div>
  );
}
