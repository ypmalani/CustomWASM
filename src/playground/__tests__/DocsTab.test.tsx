/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("Docs tab", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows language reference rules and memory layout diagram", () => {
    renderApp();
    fireEvent.click(screen.getByRole("tab", { name: "Docs" }));

    const docs = screen.getByTestId("docs-tab");
    expect(docs).toBeInTheDocument();
    expect(docs.textContent).toMatch(/functionDecl/);
    expect(docs.textContent).toMatch(/ifStmt/);
    expect(docs.textContent).toMatch(/logicalOr/);
    expect(docs.textContent).toMatch(/arrayLiteral/);
    expect(screen.getByTestId("memory-layout-diagram")).toBeInTheDocument();
    expect(screen.getByText(/0x0000–0x03FF/)).toBeInTheDocument();
  });
});
