import type { ReactNode } from "react";
import languageReference from "../docs/language-reference.generated.md?raw";
import { MemoryLayoutDiagram } from "./MemoryLayoutDiagram.js";

/** Minimal markdown → React for the generated language reference. */
function renderMarkdown(md: string) {
  const blocks = md.split(/\n(?=## )/);
  return blocks.map((block, i) => {
    const lines = block.trim().split("\n");
    if (lines.length === 0) return null;

    // Skip the HTML comment / title block's leading comment
    const content = lines.filter((l) => !l.startsWith("<!--"));
    if (content.length === 0) return null;

    const elements: ReactNode[] = [];
    let j = 0;
    while (j < content.length) {
      const line = content[j]!;
      if (line.startsWith("# ")) {
        elements.push(
          <h1 key={`h1-${j}`} className="mb-2 font-sans text-lg font-semibold text-fg">
            {line.slice(2)}
          </h1>,
        );
        j++;
      } else if (line.startsWith("## ")) {
        elements.push(
          <h2
            key={`h2-${j}`}
            className="mb-2 mt-6 border-b border-rule pb-1 font-sans text-xs font-semibold tracking-[0.12em] text-steel uppercase"
          >
            {line.slice(3)}
          </h2>,
        );
        j++;
      } else if (line.startsWith("### ")) {
        elements.push(
          <h3 key={`h3-${j}`} className="mb-1 mt-4 font-mono text-sm text-fg">
            {line.slice(4).replace(/`/g, "")}
          </h3>,
        );
        j++;
      } else if (line.startsWith("```")) {
        const fence = line.slice(3);
        j++;
        const code: string[] = [];
        while (j < content.length && !content[j]!.startsWith("```")) {
          code.push(content[j]!);
          j++;
        }
        j++; // closing fence
        elements.push(
          <pre
            key={`code-${j}`}
            className="mb-2 overflow-x-auto rounded border border-rule bg-panel p-3 font-mono text-xs text-signal"
            data-lang={fence || undefined}
          >
            {code.join("\n")}
          </pre>,
        );
      } else if (line.trim() === "") {
        j++;
      } else {
        elements.push(
          <p key={`p-${j}`} className="mb-2 font-sans text-sm text-muted">
            {line.replace(/`([^`]+)`/g, "$1")}
          </p>,
        );
        j++;
      }
    }

    return (
      <div key={i} className="mb-2">
        {elements}
      </div>
    );
  });
}

export function DocsTab() {
  return (
    <div
      data-testid="docs-tab"
      className="h-full overflow-auto bg-ink p-4 text-fg"
    >
      <section aria-label="Language reference" className="mb-8">
        {renderMarkdown(languageReference)}
      </section>
      <section aria-label="Memory layout" className="border-t border-rule pt-6">
        <MemoryLayoutDiagram />
      </section>
    </div>
  );
}
