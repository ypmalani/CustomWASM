import type { Span, Token, TokenType } from "./token.js";

const KEYWORDS: Record<string, TokenType> = {
  fn: "Fn",
  let: "Let",
  if: "If",
  else: "Else",
  while: "While",
  return: "Return",
  true: "True",
  false: "False",
  i32: "I32",
  f64: "F64",
  bool: "Bool",
  string: "String",
};

function isAlpha(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isAlphaNumeric(c: string): boolean {
  return isAlpha(c) || isDigit(c);
}

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  function peek(offset = 0): string {
    return source[pos + offset] ?? "\0";
  }

  function advance(): string {
    const c = source[pos] ?? "\0";
    pos++;
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  }

  function makeSpan(start: number, startLine: number, startCol: number): Span {
    return { start, end: pos, line: startLine, col: startCol };
  }

  function emit(type: TokenType, value: string, start: number, startLine: number, startCol: number): void {
    tokens.push({ type, value, span: makeSpan(start, startLine, startCol) });
  }

  function skipWhitespaceAndComments(): void {
    while (pos < source.length) {
      const c = peek();
      if (c === " " || c === "\t" || c === "\r" || c === "\n") {
        advance();
      } else if (c === "/" && peek(1) === "/") {
        // Line comment — skip until newline or EOF
        while (pos < source.length && peek() !== "\n") {
          advance();
        }
      } else {
        break;
      }
    }
  }

  function scanString(start: number, startLine: number, startCol: number): void {
    // Opening quote already consumed
    let value = "";
    let unterminated = true;
    while (pos < source.length) {
      const c = peek();
      if (c === '"') {
        advance(); // closing quote
        unterminated = false;
        break;
      }
      if (c === "\n" || c === "\0") {
        break;
      }
      if (c === "\\") {
        advance();
        const esc = peek();
        switch (esc) {
          case "n":
            value += "\n";
            break;
          case "t":
            value += "\t";
            break;
          case "r":
            value += "\r";
            break;
          case "\\":
            value += "\\";
            break;
          case '"':
            value += '"';
            break;
          default:
            value += esc;
            break;
        }
        advance();
      } else {
        value += advance();
      }
    }
    if (unterminated) {
      emit("Error", value, start, startLine, startCol);
      // Overwrite the last token's message-friendly value
      const last = tokens[tokens.length - 1]!;
      last.value = `unterminated string literal`;
    } else {
      emit("StringLiteral", value, start, startLine, startCol);
    }
  }

  function scanNumber(start: number, startLine: number, startCol: number): void {
    let isFloat = false;
    while (isDigit(peek())) {
      advance();
    }
    if (peek() === "." && isDigit(peek(1))) {
      isFloat = true;
      advance(); // consume '.'
      while (isDigit(peek())) {
        advance();
      }
    }
    const raw = source.slice(start, pos);
    if (isFloat) {
      emit("FloatLiteral", raw, start, startLine, startCol);
    } else {
      emit("IntLiteral", raw, start, startLine, startCol);
    }
  }

  function scanIdent(start: number, startLine: number, startCol: number): void {
    while (isAlphaNumeric(peek())) {
      advance();
    }
    const text = source.slice(start, pos);
    const kw = KEYWORDS[text];
    if (kw !== undefined) {
      emit(kw, text, start, startLine, startCol);
    } else {
      emit("Ident", text, start, startLine, startCol);
    }
  }

  while (pos < source.length) {
    skipWhitespaceAndComments();
    if (pos >= source.length) break;

    const start = pos;
    const startLine = line;
    const startCol = col;
    const c = peek();

    // Identifiers / keywords
    if (isAlpha(c)) {
      advance();
      scanIdent(start, startLine, startCol);
      continue;
    }

    // Numbers
    if (isDigit(c)) {
      advance();
      scanNumber(start, startLine, startCol);
      continue;
    }

    // String literals
    if (c === '"') {
      advance();
      scanString(start, startLine, startCol);
      continue;
    }

    // Two-character operators (longest match)
    const two = c + peek(1);
    switch (two) {
      case "==":
        advance();
        advance();
        emit("EqEq", "==", start, startLine, startCol);
        continue;
      case "!=":
        advance();
        advance();
        emit("BangEq", "!=", start, startLine, startCol);
        continue;
      case "<=":
        advance();
        advance();
        emit("LtEq", "<=", start, startLine, startCol);
        continue;
      case ">=":
        advance();
        advance();
        emit("GtEq", ">=", start, startLine, startCol);
        continue;
      case "&&":
        advance();
        advance();
        emit("AndAnd", "&&", start, startLine, startCol);
        continue;
      case "||":
        advance();
        advance();
        emit("OrOr", "||", start, startLine, startCol);
        continue;
      case "->":
        advance();
        advance();
        emit("Arrow", "->", start, startLine, startCol);
        continue;
    }

    // Single-character tokens
    advance();
    switch (c) {
      case "+":
        emit("Plus", "+", start, startLine, startCol);
        break;
      case "-":
        emit("Minus", "-", start, startLine, startCol);
        break;
      case "*":
        emit("Star", "*", start, startLine, startCol);
        break;
      case "/":
        emit("Slash", "/", start, startLine, startCol);
        break;
      case "%":
        emit("Percent", "%", start, startLine, startCol);
        break;
      case "<":
        emit("Lt", "<", start, startLine, startCol);
        break;
      case ">":
        emit("Gt", ">", start, startLine, startCol);
        break;
      case "!":
        emit("Bang", "!", start, startLine, startCol);
        break;
      case "=":
        emit("Eq", "=", start, startLine, startCol);
        break;
      case "(":
        emit("LParen", "(", start, startLine, startCol);
        break;
      case ")":
        emit("RParen", ")", start, startLine, startCol);
        break;
      case "{":
        emit("LBrace", "{", start, startLine, startCol);
        break;
      case "}":
        emit("RBrace", "}", start, startLine, startCol);
        break;
      case "[":
        emit("LBracket", "[", start, startLine, startCol);
        break;
      case "]":
        emit("RBracket", "]", start, startLine, startCol);
        break;
      case ",":
        emit("Comma", ",", start, startLine, startCol);
        break;
      case ":":
        emit("Colon", ":", start, startLine, startCol);
        break;
      case ";":
        emit("Semicolon", ";", start, startLine, startCol);
        break;
      default:
        emit("Error", `unexpected character '${c}'`, start, startLine, startCol);
        break;
    }
  }

  tokens.push({
    type: "Eof",
    value: "",
    span: { start: pos, end: pos, line, col },
  });

  return tokens;
}
