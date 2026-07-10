export interface Span {
  start: number;
  end: number;
  line: number;
  col: number;
}

export type TokenType =
  // Literals
  | "IntLiteral"
  | "FloatLiteral"
  | "StringLiteral"
  // Identifiers & keywords
  | "Ident"
  | "Fn"
  | "Let"
  | "If"
  | "Else"
  | "While"
  | "Return"
  | "True"
  | "False"
  | "I32"
  | "F64"
  | "Bool"
  | "String"
  // Operators
  | "Plus"
  | "Minus"
  | "Star"
  | "Slash"
  | "Percent"
  | "EqEq"
  | "BangEq"
  | "Lt"
  | "LtEq"
  | "Gt"
  | "GtEq"
  | "AndAnd"
  | "OrOr"
  | "Bang"
  | "Eq"
  | "Arrow"
  // Punctuation
  | "LParen"
  | "RParen"
  | "LBrace"
  | "RBrace"
  | "LBracket"
  | "RBracket"
  | "Comma"
  | "Colon"
  | "Semicolon"
  // Special
  | "Error"
  | "Eof";

export interface Token {
  type: TokenType;
  value: string;
  span: Span;
}
