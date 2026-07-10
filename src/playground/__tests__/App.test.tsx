/** @vitest-environment jsdom */
import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { PlaygroundProvider } from "../context/PlaygroundContext.js";

function renderApp() {
  return render(
    <PlaygroundProvider>
      <App />
    </PlaygroundProvider>,
  );
}

function getEditorView(): EditorView {
  const host = screen.getByTestId("source-editor");
  const cm = host.querySelector(".cm-editor");
  expect(cm).toBeTruthy();
  const view = EditorView.findFromDOM(cm as HTMLElement);
  expect(view).toBeTruthy();
  return view!;
}

async function setEditorSource(value: string): Promise<void> {
  const view = getEditorView();
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  });
  await act(async () => {
    vi.advanceTimersByTime(350);
  });
}

describe("App live-update flow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates the AST tree for a nested expression after debounce", async () => {
    renderApp();

    await setEditorSource("fn main() -> i32 { return 2 + 3 * 4; }");

    await waitFor(() => {
      expect(screen.getByTestId("ast-tab")).toBeInTheDocument();
      expect(screen.getByText("+")).toBeInTheDocument();
      expect(screen.getByText("*")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });

  it("shows an inline diagnostic with source coordinates on parse error", async () => {
    renderApp();

    await setEditorSource("fn main() -> i32 { return 1 }");

    await waitFor(() => {
      const list = screen.getByTestId("diagnostics-list");
      expect(list).toBeInTheDocument();
      expect(list.textContent).toMatch(/\d+:\d+/);
      expect(list.textContent).toMatch(/expected/i);
    });
  });

  it("renders squiggles at the parse-error span", async () => {
    renderApp();
    const src = "fn main() -> i32 { let x = 1 return x; }";
    await setEditorSource(src);

    await waitFor(() => {
      const marks = screen.getAllByTestId("diagnostic-squiggle");
      expect(marks.length).toBeGreaterThan(0);
      const mark = marks[0]!;
      const from = Number(mark.getAttribute("data-diagnostic-from"));
      const to = Number(mark.getAttribute("data-diagnostic-to"));
      expect(src.slice(from, to)).toBe("return");
      expect(mark.getAttribute("data-diagnostic-message")).toBe(
        "expected ';', found 'return'",
      );
    });
  });

  it("renders squiggles at the type-error span", async () => {
    renderApp();
    const src = "fn main() -> i32 { return 1 + 1.5; }";
    await setEditorSource(src);

    await waitFor(() => {
      const marks = screen.getAllByTestId("diagnostic-squiggle");
      expect(marks.length).toBeGreaterThan(0);
      const mark = marks[0]!;
      const from = Number(mark.getAttribute("data-diagnostic-from"));
      const to = Number(mark.getAttribute("data-diagnostic-to"));
      expect(src.slice(from, to)).toBe("1 + 1.5");
    });
  });
});
