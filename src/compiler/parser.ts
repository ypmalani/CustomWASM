import type {
  Block,
  Expr,
  FunctionDecl,
  Param,
  Program,
  Stmt,
  TypeNode,
} from "./ast.js";
import type { Diagnostic } from "./diagnostics.js";
import type { Span, Token, TokenType } from "./token.js";

export interface ParseResult {
  program: Program;
  diagnostics: Diagnostic[];
}

const STATEMENT_STARTERS: ReadonlySet<TokenType> = new Set([
  "Let",
  "If",
  "While",
  "Return",
  "LBrace",
  "Ident",
  "IntLiteral",
  "FloatLiteral",
  "StringLiteral",
  "True",
  "False",
  "LParen",
  "LBracket",
  "Bang",
  "Minus",
]);

export function parse(tokens: Token[]): ParseResult {
  const diagnostics: Diagnostic[] = [];
  let current = 0;

  function peek(offset = 0): Token {
    return tokens[current + offset] ?? tokens[tokens.length - 1]!;
  }

  function isAtEnd(): boolean {
    return peek().type === "Eof";
  }

  function check(type: TokenType): boolean {
    return peek().type === type;
  }

  function advance(): Token {
    const tok = peek();
    if (!isAtEnd()) current++;
    return tok;
  }

  function match(...types: TokenType[]): boolean {
    for (const t of types) {
      if (check(t)) {
        advance();
        return true;
      }
    }
    return false;
  }

  function error(message: string, span: Span): void {
    diagnostics.push({ message, span, severity: "error" });
  }

  function expect(type: TokenType, expected: string): Token {
    if (check(type)) return advance();
    const found = peek();
    error(`expected ${expected}, found '${found.value || found.type}'`, found.span);
    return found;
  }

  function synchronize(): void {
    advance();
    while (!isAtEnd()) {
      if (peek().type === "Semicolon") {
        advance();
        return;
      }
      if (peek().type === "RBrace") return;
      if (STATEMENT_STARTERS.has(peek().type) || peek().type === "Fn") return;
      advance();
    }
  }

  function spanOf(start: Span, end: Span): Span {
    return { start: start.start, end: end.end, line: start.line, col: start.col };
  }

  // ---- Types ----
  function parseType(): TypeNode {
    const tok = peek();
    let base: TypeNode;
    if (match("I32")) {
      base = { kind: "PrimitiveType", name: "i32", span: tok.span };
    } else if (match("F64")) {
      base = { kind: "PrimitiveType", name: "f64", span: tok.span };
    } else if (match("Bool")) {
      base = { kind: "PrimitiveType", name: "bool", span: tok.span };
    } else if (match("String")) {
      base = { kind: "PrimitiveType", name: "string", span: tok.span };
    } else {
      error(`expected type, found '${tok.value || tok.type}'`, tok.span);
      advance();
      return { kind: "PrimitiveType", name: "i32", span: tok.span };
    }
    // Array suffixes: type[][]
    while (match("LBracket")) {
      const close = expect("RBracket", "']'");
      base = {
        kind: "ArrayType",
        element: base,
        span: spanOf(base.span, close.span),
      };
    }
    return base;
  }

  // ---- Expressions (precedence climbing) ----
  function parseExpression(): Expr {
    return parseLogicalOr();
  }

  function parseLogicalOr(): Expr {
    let left = parseLogicalAnd();
    while (check("OrOr")) {
      const opTok = advance();
      const right = parseLogicalAnd();
      left = {
        kind: "Binary",
        op: "||",
        left,
        right,
        span: spanOf(left.span, right.span),
      };
      // Phase 1: note that || is lexed/parsed but not codegen'd
      void opTok;
    }
    return left;
  }

  function parseLogicalAnd(): Expr {
    let left = parseEquality();
    while (check("AndAnd")) {
      advance();
      const right = parseEquality();
      left = {
        kind: "Binary",
        op: "&&",
        left,
        right,
        span: spanOf(left.span, right.span),
      };
    }
    return left;
  }

  function parseEquality(): Expr {
    let left = parseComparison();
    while (check("EqEq") || check("BangEq")) {
      const opTok = advance();
      const right = parseComparison();
      left = {
        kind: "Binary",
        op: opTok.type === "EqEq" ? "==" : "!=",
        left,
        right,
        span: spanOf(left.span, right.span),
      };
    }
    return left;
  }

  function parseComparison(): Expr {
    let left = parseAdditive();
    while (check("Lt") || check("LtEq") || check("Gt") || check("GtEq")) {
      const opTok = advance();
      const right = parseAdditive();
      const opMap: Record<string, "<" | "<=" | ">" | ">="> = {
        Lt: "<",
        LtEq: "<=",
        Gt: ">",
        GtEq: ">=",
      };
      left = {
        kind: "Binary",
        op: opMap[opTok.type]!,
        left,
        right,
        span: spanOf(left.span, right.span),
      };
    }
    return left;
  }

  function parseAdditive(): Expr {
    let left = parseMultiplicative();
    while (check("Plus") || check("Minus")) {
      const opTok = advance();
      const right = parseMultiplicative();
      left = {
        kind: "Binary",
        op: opTok.type === "Plus" ? "+" : "-",
        left,
        right,
        span: spanOf(left.span, right.span),
      };
    }
    return left;
  }

  function parseMultiplicative(): Expr {
    let left = parseUnary();
    while (check("Star") || check("Slash") || check("Percent")) {
      const opTok = advance();
      const right = parseUnary();
      const op =
        opTok.type === "Star" ? "*" : opTok.type === "Slash" ? "/" : "%";
      left = {
        kind: "Binary",
        op,
        left,
        right,
        span: spanOf(left.span, right.span),
      };
    }
    return left;
  }

  function parseUnary(): Expr {
    if (check("Bang") || check("Minus")) {
      const opTok = advance();
      const operand = parseUnary();
      return {
        kind: "Unary",
        op: opTok.type === "Bang" ? "!" : "-",
        operand,
        span: spanOf(opTok.span, operand.span),
      };
    }
    return parsePostfix();
  }

  function parsePostfix(): Expr {
    let expr = parsePrimary();
    while (true) {
      if (check("LParen")) {
        // Call
        const open = advance();
        const args: Expr[] = [];
        if (!check("RParen")) {
          do {
            args.push(parseExpression());
          } while (match("Comma"));
        }
        const close = expect("RParen", "')'");
        if (expr.kind !== "Identifier") {
          error("callee must be an identifier", open.span);
          expr = {
            kind: "Call",
            callee: "<error>",
            args,
            span: spanOf(expr.span, close.span),
          };
        } else {
          expr = {
            kind: "Call",
            callee: expr.name,
            args,
            span: spanOf(expr.span, close.span),
          };
        }
      } else if (check("LBracket")) {
        advance();
        const index = parseExpression();
        const close = expect("RBracket", "']'");
        expr = {
          kind: "Index",
          target: expr,
          index,
          span: spanOf(expr.span, close.span),
        };
      } else {
        break;
      }
    }
    return expr;
  }

  function parsePrimary(): Expr {
    const tok = peek();

    if (match("IntLiteral")) {
      return { kind: "IntLiteral", value: Number(tok.value), span: tok.span };
    }
    if (match("FloatLiteral")) {
      return { kind: "FloatLiteral", value: Number(tok.value), span: tok.span };
    }
    if (match("StringLiteral")) {
      return { kind: "StringLiteral", value: tok.value, span: tok.span };
    }
    if (match("True")) {
      return { kind: "BoolLiteral", value: true, span: tok.span };
    }
    if (match("False")) {
      return { kind: "BoolLiteral", value: false, span: tok.span };
    }
    if (match("Ident")) {
      return { kind: "Identifier", name: tok.value, span: tok.span };
    }
    if (match("LParen")) {
      const expr = parseExpression();
      expect("RParen", "')'");
      return expr;
    }
    if (match("LBracket")) {
      const elements: Expr[] = [];
      if (!check("RBracket")) {
        do {
          elements.push(parseExpression());
        } while (match("Comma"));
      }
      const close = expect("RBracket", "']'");
      return {
        kind: "ArrayLiteral",
        elements,
        span: spanOf(tok.span, close.span),
      };
    }

    error(`expected expression, found '${tok.value || tok.type}'`, tok.span);
    advance();
    return { kind: "IntLiteral", value: 0, span: tok.span };
  }

  // ---- Statements ----
  function parseBlock(): Block {
    const open = expect("LBrace", "'{'");
    const statements: Stmt[] = [];
    while (!check("RBrace") && !isAtEnd()) {
      try {
        statements.push(parseStatement());
      } catch {
        synchronize();
      }
    }
    const close = expect("RBrace", "'}'");
    return {
      kind: "Block",
      statements,
      span: spanOf(open.span, close.span),
    };
  }

  function parseStatement(): Stmt {
    if (check("Let")) return parseLet();
    if (check("If")) return parseIf();
    if (check("While")) return parseWhile();
    if (check("Return")) return parseReturn();
    if (check("LBrace")) return parseBlock();

    // Assignment or expression statement
    const expr = parseExpression();
    if (check("Eq")) {
      // Assignment: lvalue = expr ;
      advance(); // =
      const value = parseExpression();
      const semi = expect("Semicolon", "';'");
      return {
        kind: "Assign",
        target: expr,
        value,
        span: spanOf(expr.span, semi.span),
      };
    }
    const semi = expect("Semicolon", "';'");
    return {
      kind: "ExprStmt",
      expr,
      span: spanOf(expr.span, semi.span),
    };
  }

  function parseLet(): Stmt {
    const letTok = expect("Let", "'let'");
    const nameTok = expect("Ident", "identifier");
    let declaredType: TypeNode | undefined;
    if (match("Colon")) {
      declaredType = parseType();
    }
    expect("Eq", "'='");
    const init = parseExpression();
    const semi = expect("Semicolon", "';'");
    return {
      kind: "Let",
      name: nameTok.value,
      declaredType,
      init,
      span: spanOf(letTok.span, semi.span),
    };
  }

  function parseIf(): Stmt {
    const ifTok = expect("If", "'if'");
    expect("LParen", "'('");
    const cond = parseExpression();
    expect("RParen", "')'");
    const then = parseBlock();
    let else_: Block | Stmt | undefined;
    if (match("Else")) {
      if (check("If")) {
        else_ = parseIf();
      } else {
        else_ = parseBlock();
      }
    }
    const endSpan = else_
      ? else_.kind === "If"
        ? else_.span
        : else_.span
      : then.span;
    return {
      kind: "If",
      cond,
      then,
      else_,
      span: spanOf(ifTok.span, endSpan),
    };
  }

  function parseWhile(): Stmt {
    const whileTok = expect("While", "'while'");
    expect("LParen", "'('");
    const cond = parseExpression();
    expect("RParen", "')'");
    const body = parseBlock();
    return {
      kind: "While",
      cond,
      body,
      span: spanOf(whileTok.span, body.span),
    };
  }

  function parseReturn(): Stmt {
    const retTok = expect("Return", "'return'");
    let value: Expr | undefined;
    if (!check("Semicolon")) {
      value = parseExpression();
    }
    const semi = expect("Semicolon", "';'");
    return {
      kind: "Return",
      value,
      span: spanOf(retTok.span, semi.span),
    };
  }

  // ---- Declarations ----
  function parseParam(): Param {
    const nameTok = expect("Ident", "parameter name");
    expect("Colon", "':'");
    const type = parseType();
    return {
      name: nameTok.value,
      type,
      span: spanOf(nameTok.span, type.span),
    };
  }

  function parseFunction(): FunctionDecl {
    const fnTok = expect("Fn", "'fn'");
    const nameTok = expect("Ident", "function name");
    expect("LParen", "'('");
    const params: Param[] = [];
    if (!check("RParen")) {
      do {
        params.push(parseParam());
      } while (match("Comma"));
    }
    expect("RParen", "')'");
    let returnType: TypeNode | undefined;
    if (match("Arrow")) {
      returnType = parseType();
    }
    const body = parseBlock();
    return {
      kind: "Function",
      name: nameTok.value,
      params,
      returnType,
      body,
      span: spanOf(fnTok.span, body.span),
    };
  }

  function parseProgram(): Program {
    const functions: FunctionDecl[] = [];
    while (!isAtEnd()) {
      if (check("Fn")) {
        try {
          functions.push(parseFunction());
        } catch {
          synchronize();
        }
      } else {
        const tok = peek();
        error(`expected 'fn', found '${tok.value || tok.type}'`, tok.span);
        synchronize();
      }
    }
    return { kind: "Program", functions };
  }

  const program = parseProgram();
  return { program, diagnostics };
}
