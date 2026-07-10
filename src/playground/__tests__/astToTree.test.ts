import { describe, expect, it } from "vitest";
import type { Program } from "../../compiler/ast.js";
import { parse } from "../../compiler/parser.js";
import { lex } from "../../compiler/lexer.js";
import { astToTree, type TreeNode } from "../lib/astToTree.js";

function parseProgram(source: string): Program {
  const { program, diagnostics } = parse(lex(source));
  expect(diagnostics).toEqual([]);
  return program;
}

function findByLabel(node: TreeNode, label: string): TreeNode | undefined {
  if (node.label === label) return node;
  for (const child of node.children) {
    const found = findByLabel(child, label);
    if (found) return found;
  }
  return undefined;
}

describe("astToTree", () => {
  it("renders Program → Function → Block for a minimal main", () => {
    const program = parseProgram("fn main() -> i32 { return 1; }");
    const tree = astToTree(program);

    expect(tree.label).toBe("Program");
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]!.label).toBe("Function");
    expect(tree.children[0]!.detail).toBe("main");

    const block = findByLabel(tree, "Block");
    expect(block).toBeDefined();
    expect(block!.children[0]!.label).toBe("Return");
    expect(block!.children[0]!.children[0]).toMatchObject({
      label: "IntLiteral",
      detail: "1",
    });
  });

  it("nests Binary(2 + 3 * 4) with correct precedence shape", () => {
    // 2 + 3 * 4  ⇒  Binary(+) { IntLiteral(2), Binary(*) { 3, 4 } }
    const program = parseProgram(
      "fn main() -> i32 { return 2 + 3 * 4; }",
    );
    const tree = astToTree(program);
    const ret = findByLabel(tree, "Return");
    expect(ret).toBeDefined();

    const add = ret!.children[0]!;
    expect(add).toMatchObject({ label: "Binary", detail: "+" });
    expect(add.children[0]).toMatchObject({
      label: "IntLiteral",
      detail: "2",
    });

    const mul = add.children[1]!;
    expect(mul).toMatchObject({ label: "Binary", detail: "*" });
    expect(mul.children[0]).toMatchObject({
      label: "IntLiteral",
      detail: "3",
    });
    expect(mul.children[1]).toMatchObject({
      label: "IntLiteral",
      detail: "4",
    });
  });

  it("renders Let with Identifier init", () => {
    const program = parseProgram(
      "fn main() -> i32 { let x = 42; return x; }",
    );
    const tree = astToTree(program);
    const letNode = findByLabel(tree, "Let");
    expect(letNode).toMatchObject({ label: "Let", detail: "x" });
    expect(letNode!.children[0]).toMatchObject({
      label: "IntLiteral",
      detail: "42",
    });

    const id = findByLabel(tree, "Identifier");
    expect(id).toMatchObject({ label: "Identifier", detail: "x" });
  });

  it("renders PrimitiveType for return type", () => {
    const program = parseProgram("fn main() -> i32 { return 0; }");
    const tree = astToTree(program);
    const prim = findByLabel(tree, "PrimitiveType");
    expect(prim).toMatchObject({
      label: "PrimitiveType",
      detail: "i32",
    });
  });
});
