import type { Span } from "./token.js";

// ---- Types ----
export type TypeNode =
  | { kind: "PrimitiveType"; name: "i32" | "f64" | "bool" | "string"; span: Span }
  | { kind: "ArrayType"; element: TypeNode; span: Span };

// ---- Expressions ----
export type Expr =
  | { kind: "IntLiteral"; value: number; span: Span }
  | { kind: "FloatLiteral"; value: number; span: Span }
  | { kind: "BoolLiteral"; value: boolean; span: Span }
  | { kind: "StringLiteral"; value: string; span: Span }
  | { kind: "ArrayLiteral"; elements: Expr[]; span: Span }
  | { kind: "Identifier"; name: string; span: Span }
  | { kind: "Unary"; op: "!" | "-"; operand: Expr; span: Span }
  | { kind: "Binary"; op: BinOp; left: Expr; right: Expr; span: Span }
  | { kind: "Call"; callee: string; args: Expr[]; span: Span }
  | { kind: "Index"; target: Expr; index: Expr; span: Span };

export type BinOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||";

// ---- Statements ----
export type Stmt =
  | { kind: "Let"; name: string; declaredType?: TypeNode; init: Expr; span: Span }
  | { kind: "Assign"; target: Expr /* Identifier | Index */; value: Expr; span: Span }
  | { kind: "If"; cond: Expr; then: Block; else_?: Block | Stmt; span: Span }
  | { kind: "While"; cond: Expr; body: Block; span: Span }
  | { kind: "Return"; value?: Expr; span: Span }
  | { kind: "ExprStmt"; expr: Expr; span: Span }
  | Block;

export interface Block {
  kind: "Block";
  statements: Stmt[];
  span: Span;
}

// ---- Declarations ----
export interface Param {
  name: string;
  type: TypeNode;
  span: Span;
}

export interface FunctionDecl {
  kind: "Function";
  name: string;
  params: Param[];
  returnType?: TypeNode;
  body: Block;
  span: Span;
}

export interface Program {
  kind: "Program";
  functions: FunctionDecl[];
}
