import { describe, expect, it } from "vitest";
import languageReference from "../docs/language-reference.generated.md?raw";

describe("language-reference.generated.md", () => {
  it("includes key grammar rules from architecture.md", () => {
    const required = [
      "program",
      "functionDecl",
      "ifStmt",
      "logicalOr",
      "arrayLiteral",
    ];
    for (const rule of required) {
      expect(languageReference).toContain(`### \`${rule}\``);
    }

    // Spot-check that generated bodies match architecture EBNF snippets
    expect(languageReference).toContain('functionDecl = "fn" IDENT');
    expect(languageReference).toContain(
      'ifStmt = "if" "(" expression ")"',
    );
    expect(languageReference).toContain(
      'logicalOr = logicalAnd { "||" logicalAnd }',
    );
    expect(languageReference).toContain(
      'arrayLiteral = "[" [ argList ] "]"',
    );
  });
});
