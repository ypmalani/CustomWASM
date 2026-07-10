import { useEffect, useState } from "react";
import { usePlayground } from "../context/PlaygroundContext.js";
import { AstTab } from "./AstTab.js";
import { DiagnosticsList } from "./DiagnosticsList.js";
import { DocsTab } from "./DocsTab.js";
import { IrTab } from "./IrTab.js";
import { OptimizedIrTab } from "./OptimizedIrTab.js";
import { OutputTab } from "./OutputTab.js";
import { StepperTab } from "./StepperTab.js";
import { WatTab } from "./WatTab.js";

export type InspectorTabId =
  | "ast"
  | "ir"
  | "optimized-ir"
  | "wat"
  | "stepper"
  | "output"
  | "docs";

const TABS: { id: InspectorTabId; label: string }[] = [
  { id: "ast", label: "AST" },
  { id: "ir", label: "IR" },
  { id: "optimized-ir", label: "Optimized IR" },
  { id: "wat", label: "WAT" },
  { id: "stepper", label: "Stepper" },
  { id: "output", label: "Output" },
  { id: "docs", label: "Docs" },
];

export interface InspectorProps {
  activeTab: InspectorTabId;
  onActiveTabChange: (tab: InspectorTabId) => void;
}

export function Inspector({ activeTab, onActiveTabChange }: InspectorProps) {
  const { result, runOutput } = usePlayground();
  const [crossfading, setCrossfading] = useState(false);

  useEffect(() => {
    setCrossfading(true);
    const t = setTimeout(() => setCrossfading(false), 200);
    return () => clearTimeout(t);
  }, [result]);

  return (
    <div className="flex h-full flex-col bg-ink">
      <DiagnosticsList diagnostics={result.diagnostics} />
      <div
        role="tablist"
        aria-label="Inspector tabs"
        className="flex shrink-0 overflow-x-auto border-b border-rule bg-panel"
      >
        {TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={
                selected
                  ? "border-b-2 border-signal px-3 py-2 font-sans text-xs font-medium tracking-wide text-signal whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
                  : "border-b-2 border-transparent px-3 py-2 font-sans text-xs tracking-wide text-muted whitespace-nowrap hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-signal"
              }
              onClick={() => onActiveTabChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className={`min-h-0 flex-1 overflow-hidden${crossfading ? " pane-crossfade" : ""}`}
        role="tabpanel"
      >
        {activeTab === "ast" && (
          <AstTab
            ast={result.ast}
            hasErrors={result.diagnostics.length > 0}
          />
        )}
        {activeTab === "ir" && <IrTab ir={result.ir} />}
        {activeTab === "optimized-ir" && (
          <OptimizedIrTab ir={result.ir} optimizedIr={result.optimizedIr} />
        )}
        {activeTab === "wat" && <WatTab wat={result.wat} />}
        {activeTab === "stepper" && <StepperTab ir={result.ir} />}
        {activeTab === "output" && <OutputTab lines={runOutput} />}
        {activeTab === "docs" && <DocsTab />}
      </div>
    </div>
  );
}
