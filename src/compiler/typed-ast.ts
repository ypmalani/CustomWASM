import type { BinOp, TypeNode } from "./ast.js";
import type { Span } from "./token.js";
import type { Type } from "./types.js";

/** Resolved binding for a typed identifier. */
export interface BindingRef {
  name: string;
  kind: "param" | "local";
}

// ---- Expressions (every node carries a resolved type) ----
export type TypedExpr =
  | { kind: "IntLiteral"; value: number; span: Span; type: Type }
  | { kind: "FloatLiteral"; value: number; span: Span; type: Type }
  | { kind: "BoolLiteral"; value: boolean; span: Span; type: Type }
  | { kind: "StringLiteral"; value: string; span: Span; type: Type }
  | { kind: "ArrayLiteral"; elements: TypedExpr[]; span: Span; type: Type }
  | {
      kind: "Identifier";
      name: string;
      span: Span;
      type: Type;
      binding: BindingRef | null;
    }
  | {
      kind: "Unary";
      op: "!" | "-";
      operand: TypedExpr;
      span: Span;
      type: Type;
    }
  | {
      kind: "Binary";
      op: BinOp;
      left: TypedExpr;
      right: TypedExpr;
      span: Span;
      type: Type;
    }
  | {
      kind: "Call";
      callee: string;
      args: TypedExpr[];
      span: Span;
      type: Type;
    }
  | {
      kind: "Index";
      target: TypedExpr;
      index: TypedExpr;
      span: Span;
      type: Type;
    };

// ---- Statements ----
export type TypedStmt =
  | {
      kind: "Let";
      name: string;
      declaredType?: TypeNode;
      init: TypedExpr;
      span: Span;
      type: Type;
    }
  | {
      kind: "Assign";
      target: TypedExpr;
      value: TypedExpr;
      span: Span;
    }
  | {
      kind: "If";
      cond: TypedExpr;
      then: TypedBlock;
      else_?: TypedBlock | TypedStmt;
      span: Span;
    }
  | { kind: "While"; cond: TypedExpr; body: TypedBlock; span: Span }
  | { kind: "Return"; value?: TypedExpr; span: Span }
  | { kind: "ExprStmt"; expr: TypedExpr; span: Span }
  | TypedBlock;

export interface TypedBlock {
  kind: "Block";
  statements: TypedStmt[];
  span: Span;
}

// ---- Declarations ----
export interface TypedParam {
  name: string;
  type: TypeNode;
  resolvedType: Type;
  span: Span;
}

export interface TypedFunctionDecl {
  kind: "Function";
  name: string;
  params: TypedParam[];
  returnType?: TypeNode;
  resolvedReturnType: Type;
  body: TypedBlock;
  span: Span;
}

export interface TypedProgram {
  kind: "Program";
  functions: TypedFunctionDecl[];
}
