import { useState } from "react";
import { usePlayground } from "../context/PlaygroundContext.js";
import { AstTab } from "./AstTab.js";
import { DiagnosticsList } from "./DiagnosticsList.js";
import { OutputTab } from "./OutputTab.js";
import { WatTab } from "./WatTab.js";

type TabId = "ast" | "wat" | "output";

const TABS: { id: TabId; label: string }[] = [
  { id: "ast", label: "AST" },
  { id: "wat", label: "WAT" },
  { id: "output", label: "Output" },
];

export function Inspector() {
  const { result, runOutput } = usePlayground();
  const [active, setActive] = useState<TabId>("ast");

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <DiagnosticsList diagnostics={result.diagnostics} />
      <div
        role="tablist"
        aria-label="Inspector tabs"
        className="flex shrink-0 border-b border-slate-800"
      >
        {TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={
                selected
                  ? "border-b-2 border-sky-400 px-4 py-2 text-sm font-medium text-sky-300"
                  : "border-b-2 border-transparent px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              }
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" role="tabpanel">
        {active === "ast" && (
          <AstTab
            ast={result.ast}
            hasErrors={result.diagnostics.length > 0}
          />
        )}
        {active === "wat" && <WatTab wat={result.wat} />}
        {active === "output" && <OutputTab lines={runOutput} />}
      </div>
    </div>
  );
}
