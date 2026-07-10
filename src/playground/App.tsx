import { useState } from "react";
import { Editor } from "./components/Editor.js";
import {
  Inspector,
  type InspectorTabId,
} from "./components/Inspector.js";
import { PipelineStageRail } from "./components/PipelineStageRail.js";
import { RunButton } from "./components/RunButton.js";
import { usePlayground } from "./context/PlaygroundContext.js";
import { useAutoplayIntro } from "./hooks/useAutoplayIntro.js";

export function App() {
  const { result, setSource, run, wabt, wabtLoading } = usePlayground();
  const [activeTab, setActiveTab] = useState<InspectorTabId>("ast");
  const { playing, skip, interrupt } = useAutoplayIntro({
    setSource,
    run,
    setActiveTab,
    wabtReady: !!wabt && !wabtLoading,
  });

  return (
    <div className="flex h-screen flex-col bg-ink text-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-rule bg-panel px-4 py-2.5">
        <h1 className="font-sans text-sm font-semibold tracking-wide text-fg">
          CustomWASM
        </h1>
        <div className="flex items-center gap-3">
          {playing && (
            <button
              type="button"
              data-autoplay-skip
              data-testid="skip-intro"
              onClick={skip}
              className="font-sans text-xs tracking-wide text-muted hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
            >
              Skip intro
            </button>
          )}
          <RunButton />
        </div>
      </header>
      <PipelineStageRail result={result} />
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section
          aria-label="Source"
          className="flex min-h-48 flex-col border-b border-rule md:min-h-0 md:border-r md:border-b-0"
        >
          <div className="shrink-0 border-b border-rule bg-panel px-3 py-1.5">
            <span className="font-sans text-[10px] font-medium tracking-[0.14em] text-muted uppercase">
              Source
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <Editor onUserFocus={interrupt} />
          </div>
        </section>
        <section
          aria-label="Inspector"
          className="min-h-48 md:min-h-0"
        >
          <Inspector
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
          />
        </section>
      </div>
    </div>
  );
}
