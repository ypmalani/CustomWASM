import type { Token, TokenType } from "../token.js";
import { lex } from "../lexer.js";

function typesOf(tokens: Token[]): TokenType[] {
  return tokens.map((t) => t.type);
}

describe("lexer", () => {
  it("tokenizes integers and arithmetic operators", () => {
    const tokens = lex("2 + 3 * 4");
    expect(typesOf(tokens)).toEqual([
      "IntLiteral",
      "Plus",
      "IntLiteral",
      "Star",
      "IntLiteral",
      "Eof",
    ]);
    expect(tokens[0]!.value).toBe("2");
    expect(tokens[2]!.value).toBe("3");
    expect(tokens[4]!.value).toBe("4");
  });

  it("produces exact spans for a simple expression", () => {
    //          0123456789
    const src = "let x = 1;";
    const tokens = lex(src);
    expect(tokens[0]).toMatchObject({
      type: "Let",
      value: "let",
      span: { start: 0, end: 3, line: 1, col: 1 },
    });
    expect(tokens[1]).toMatchObject({
      type: "Ident",
      value: "x",
      span: { start: 4, end: 5, line: 1, col: 5 },
    });
    expect(tokens[2]).toMatchObject({
      type: "Eq",
      value: "=",
      span: { start: 6, end: 7, line: 1, col: 7 },
    });
    expect(tokens[3]).toMatchObject({
      type: "IntLiteral",
      value: "1",
      span: { start: 8, end: 9, line: 1, col: 9 },
    });
    expect(tokens[4]).toMatchObject({
      type: "Semicolon",
      value: ";",
      span: { start: 9, end: 10, line: 1, col: 10 },
    });
  });

  it("tracks line and column across newlines", () => {
    const tokens = lex("a\nb");
    expect(tokens[0]!.span).toEqual({ start: 0, end: 1, line: 1, col: 1 });
    expect(tokens[1]!.span).toEqual({ start: 2, end: 3, line: 2, col: 1 });
  });

  it("uses longest-match for multi-char operators", () => {
    const tokens = lex("<= >= == != && || ->");
    expect(typesOf(tokens)).toEqual([
      "LtEq",
      "GtEq",
      "EqEq",
      "BangEq",
      "AndAnd",
      "OrOr",
      "Arrow",
      "Eof",
    ]);
  });

  it("does not split <= into < and =", () => {
    const tokens = lex("a<=b");
    expect(typesOf(tokens)).toEqual(["Ident", "LtEq", "Ident", "Eof"]);
  });

  it("reclassifies keywords after identifier scanning", () => {
    const tokens = lex("let letter fn return if else while true false i32 f64 bool string");
    expect(typesOf(tokens)).toEqual([
      "Let",
      "Ident", // letter
      "Fn",
      "Return",
      "If",
      "Else",
      "While",
      "True",
      "False",
      "I32",
      "F64",
      "Bool",
      "String",
      "Eof",
    ]);
    expect(tokens[1]!.value).toBe("letter");
  });

  it("skips // line comments", () => {
    const tokens = lex("1 // comment\n+ 2");
    expect(typesOf(tokens)).toEqual(["IntLiteral", "Plus", "IntLiteral", "Eof"]);
  });

  it("lexes float literals", () => {
    const tokens = lex("3.14");
    expect(tokens[0]).toMatchObject({ type: "FloatLiteral", value: "3.14" });
  });

  it("lexes string literals with escapes", () => {
    const tokens = lex('"hello\\nworld"');
    expect(tokens[0]).toMatchObject({
      type: "StringLiteral",
      value: "hello\nworld",
    });
  });

  it("emits Error token for unterminated string", () => {
    const tokens = lex('"oops');
    expect(tokens[0]!.type).toBe("Error");
    expect(tokens[0]!.value).toContain("unterminated");
    expect(tokens[0]!.span.start).toBe(0);
  });

  it("emits Error token for unknown characters", () => {
    const tokens = lex("@");
    expect(tokens[0]!.type).toBe("Error");
    expect(tokens[0]!.value).toContain("@");
    expect(tokens[0]!.span).toEqual({ start: 0, end: 1, line: 1, col: 1 });
  });

  it("lexes punctuation", () => {
    const tokens = lex("(){}[],:;");
    expect(typesOf(tokens)).toEqual([
      "LParen",
      "RParen",
      "LBrace",
      "RBrace",
      "LBracket",
      "RBracket",
      "Comma",
      "Colon",
      "Semicolon",
      "Eof",
    ]);
  });

  it("never throws on adversarial input", () => {
    expect(() => lex('fn main() { let x = "unterminated')).not.toThrow();
    expect(() => lex("@@@###$$$")).not.toThrow();
    expect(() => lex("")).not.toThrow();
  });
});
