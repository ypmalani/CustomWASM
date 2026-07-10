/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { App } from "../App.js";
import { PlaygroundProvider } from "../context/PlaygroundContext.js";

function renderApp() {
  return render(
    <PlaygroundProvider>
      <App />
    </PlaygroundProvider>,
  );
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

    const editor = screen.getByLabelText("Source editor");
    // Clear default and type a nested-expression program
    fireEvent.change(editor, {
      target: {
        value: "fn main() -> i32 { return 2 + 3 * 4; }",
      },
    });

    // Before debounce, the default AST (let x = ...) may still be showing.
    // Advance past the 300ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      expect(screen.getByTestId("ast-tab")).toBeInTheDocument();
      // Nested Binary nodes for + and *
      expect(screen.getByText("+")).toBeInTheDocument();
      expect(screen.getByText("*")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.getByText("4")).toBeInTheDocument();
    });
  });

  it("shows an inline diagnostic with source coordinates on parse error", async () => {
    renderApp();

    const editor = screen.getByLabelText("Source editor");
    // Missing semicolon after return expression
    fireEvent.change(editor, {
      target: {
        value: "fn main() -> i32 { return 1 }",
      },
    });

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    await waitFor(() => {
      const list = screen.getByTestId("diagnostics-list");
      expect(list).toBeInTheDocument();
      // Diagnostic text includes line:col and an "expected" message
      expect(list.textContent).toMatch(/\d+:\d+/);
      expect(list.textContent).toMatch(/expected/i);
    });
  });
});
