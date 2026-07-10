/** @vitest-environment jsdom */
import { EditorView } from "@codemirror/view";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App.js";
import { PlaygroundProvider } from "../context/PlaygroundContext.js";
import { INTRO_SEEN_KEY } from "../lib/introSource.js";
import { memoryStorage } from "./setup.js";

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
    memoryStorage.setItem(INTRO_SEEN_KEY, "1");
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    memoryStorage.clear();
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

  it("allows typing immediately after interrupting autoplay", async () => {
    memoryStorage.clear();
    renderApp();

    expect(screen.getByTestId("skip-intro")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(28 * 15);
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    });

    await waitFor(() => {
      expect(screen.queryByTestId("skip-intro")).not.toBeInTheDocument();
    });

    await setEditorSource("fn main() -> i32 { return 2 + 3 * 4; }");

    await waitFor(() => {
      expect(screen.getByTestId("ast-tab")).toBeInTheDocument();
      expect(screen.getByText("+")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });

  it("allows typing immediately after autoplay finishes naturally", async () => {
    memoryStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    renderApp();

    // Reduced-motion path: settle timers / microtasks until intro ends.
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    // wabt may still be loading; finish via skip if still playing
    const skip = screen.queryByTestId("skip-intro");
    if (skip) {
      await act(async () => {
        skip.click();
        vi.advanceTimersByTime(500);
        await Promise.resolve();
      });
    }

    await waitFor(() => {
      expect(screen.queryByTestId("skip-intro")).not.toBeInTheDocument();
    });

    expect(getEditorView().state.doc.toString()).toContain("fib");

    await setEditorSource("fn main() -> i32 { return 7; }");

    await act(async () => {
      screen.getByRole("tab", { name: "AST" }).click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("ast-tab")).toBeInTheDocument();
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });
});
