/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { lex } from "../../compiler/lexer.js";
import { parse } from "../../compiler/parser.js";
import { AstTab } from "../components/AstTab.js";

describe("AstTab", () => {
  it("renders expected node labels for a nested expression AST", () => {
    const { program, diagnostics } = parse(
      lex("fn main() -> i32 { return 2 + 3 * 4; }"),
    );
    expect(diagnostics).toEqual([]);

    render(<AstTab ast={program} hasErrors={false} />);

    expect(screen.getByTestId("ast-tab")).toBeInTheDocument();
    expect(screen.getByText("Program")).toBeInTheDocument();
    expect(screen.getByText("Function")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    // Two Binary nodes (+ and *)
    expect(screen.getAllByText("Binary")).toHaveLength(2);
    expect(screen.getByText("+")).toBeInTheDocument();
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows a partial-AST notice when hasErrors is true", () => {
    const { program } = parse(lex("fn main() -> i32 { return 1; }"));
    render(<AstTab ast={program} hasErrors={true} />);
    expect(
      screen.getByText(/Parse errors present/i),
    ).toBeInTheDocument();
  });
});
