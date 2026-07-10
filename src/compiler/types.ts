import type { TypeNode } from "./ast.js";

/**
 * Resolved (semantic) types, distinct from syntactic TypeNode.
 * The internal `error` kind unifies with everything to suppress cascade diagnostics.
 */
export type Type =
  | { kind: "i32" }
  | { kind: "f64" }
  | { kind: "bool" }
  | { kind: "string" }
  | { kind: "array"; element: Type }
  | { kind: "void" }
  | { kind: "error" };

export const TY_I32: Type = { kind: "i32" };
export const TY_F64: Type = { kind: "f64" };
export const TY_BOOL: Type = { kind: "bool" };
export const TY_STRING: Type = { kind: "string" };
export const TY_VOID: Type = { kind: "void" };
export const TY_ERROR: Type = { kind: "error" };

/** Structural equality; `error` unifies with every type. */
export function typeEquals(a: Type, b: Type): boolean {
  if (a.kind === "error" || b.kind === "error") return true;
  if (a.kind !== b.kind) return false;
  if (a.kind === "array" && b.kind === "array") {
    return typeEquals(a.element, b.element);
  }
  return true;
}

export function typeToString(t: Type): string {
  switch (t.kind) {
    case "i32":
    case "f64":
    case "bool":
    case "string":
    case "void":
      return t.kind;
    case "array":
      return `${typeToString(t.element)}[]`;
    case "error":
      return "<error>";
    default: {
      const _exhaustive: never = t;
      return (_exhaustive as Type).kind;
    }
  }
}

export function typeNodeToType(node: TypeNode): Type {
  if (node.kind === "PrimitiveType") {
    switch (node.name) {
      case "i32":
        return TY_I32;
      case "f64":
        return TY_F64;
      case "bool":
        return TY_BOOL;
      case "string":
        return TY_STRING;
      default: {
        const _exhaustive: never = node.name;
        void _exhaustive;
        return TY_ERROR;
      }
    }
  }
  return { kind: "array", element: typeNodeToType(node.element) };
}

export function isNumeric(t: Type): boolean {
  return t.kind === "i32" || t.kind === "f64" || t.kind === "error";
}
