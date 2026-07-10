/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TreeView } from "../components/TreeView.js";
import type { TreeNode } from "../lib/astToTree.js";

const sample: TreeNode = {
  label: "Program",
  children: [
    {
      label: "Function",
      detail: "main",
      children: [
        {
          label: "Block",
          children: [
            {
              label: "Return",
              children: [{ label: "IntLiteral", detail: "1", children: [] }],
            },
          ],
        },
      ],
    },
  ],
};

describe("TreeView", () => {
  it("renders node labels for a given tree shape", () => {
    render(<TreeView node={sample} />);

    expect(screen.getByText("Program")).toBeInTheDocument();
    expect(screen.getByText("Function")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("Block")).toBeInTheDocument();
    expect(screen.getByText("Return")).toBeInTheDocument();
    expect(screen.getByText("IntLiteral")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("collapses and expands children when the toggle is clicked", () => {
    render(<TreeView node={sample} />);

    expect(screen.getByText("Function")).toBeInTheDocument();

    const collapse = screen.getByRole("button", { name: "Collapse Program" });
    fireEvent.click(collapse);

    expect(screen.queryByText("Function")).not.toBeInTheDocument();
    expect(screen.getByText("Program")).toBeInTheDocument();

    const expand = screen.getByRole("button", { name: "Expand Program" });
    fireEvent.click(expand);

    expect(screen.getByText("Function")).toBeInTheDocument();
  });
});
