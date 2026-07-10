import type {
  Block,
  Expr,
  FunctionDecl,
  Param,
  Program,
  Stmt,
  TypeNode,
} from "../../compiler/ast.js";
import type { Span } from "../../compiler/token.js";

/** Generic tree node shared by AST (and later IR) tabs. */
export interface TreeNode {
  label: string;
  detail?: string;
  span?: Span;
  children: TreeNode[];
}

function typeToTree(t: TypeNode): TreeNode {
  switch (t.kind) {
    case "PrimitiveType":
      return { label: "PrimitiveType", detail: t.name, span: t.span, children: [] };
    case "ArrayType":
      return {
        label: "ArrayType",
        span: t.span,
        children: [typeToTree(t.element)],
      };
    default: {
      const _exhaustive: never = t;
      return { label: `Unknown(${(_exhaustive as TypeNode).kind})`, children: [] };
    }
  }
}

function exprToTree(expr: Expr): TreeNode {
  switch (expr.kind) {
    case "IntLiteral":
      return {
        label: "IntLiteral",
        detail: String(expr.value),
        span: expr.span,
        children: [],
      };
    case "FloatLiteral":
      return {
        label: "FloatLiteral",
        detail: String(expr.value),
        span: expr.span,
        children: [],
      };
    case "BoolLiteral":
      return {
        label: "BoolLiteral",
        detail: String(expr.value),
        span: expr.span,
        children: [],
      };
    case "StringLiteral":
      return {
        label: "StringLiteral",
        detail: JSON.stringify(expr.value),
        span: expr.span,
        children: [],
      };
    case "ArrayLiteral":
      return {
        label: "ArrayLiteral",
        span: expr.span,
        children: expr.elements.map(exprToTree),
      };
    case "Identifier":
      return {
        label: "Identifier",
        detail: expr.name,
        span: expr.span,
        children: [],
      };
    case "Unary":
      return {
        label: "Unary",
        detail: expr.op,
        span: expr.span,
        children: [exprToTree(expr.operand)],
      };
    case "Binary":
      return {
        label: "Binary",
        detail: expr.op,
        span: expr.span,
        children: [exprToTree(expr.left), exprToTree(expr.right)],
      };
    case "Call":
      return {
        label: "Call",
        detail: expr.callee,
        span: expr.span,
        children: expr.args.map(exprToTree),
      };
    case "Index":
      return {
        label: "Index",
        span: expr.span,
        children: [exprToTree(expr.target), exprToTree(expr.index)],
      };
    default: {
      const _exhaustive: never = expr;
      return {
        label: `Unknown(${(_exhaustive as Expr).kind})`,
        children: [],
      };
    }
  }
}

function stmtToTree(stmt: Stmt): TreeNode {
  switch (stmt.kind) {
    case "Let": {
      const children: TreeNode[] = [];
      if (stmt.declaredType) {
        children.push(typeToTree(stmt.declaredType));
      }
      children.push(exprToTree(stmt.init));
      return {
        label: "Let",
        detail: stmt.name,
        span: stmt.span,
        children,
      };
    }
    case "Assign":
      return {
        label: "Assign",
        span: stmt.span,
        children: [exprToTree(stmt.target), exprToTree(stmt.value)],
      };
    case "If": {
      const children: TreeNode[] = [
        exprToTree(stmt.cond),
        blockToTree(stmt.then),
      ];
      if (stmt.else_) {
        children.push(
          stmt.else_.kind === "Block"
            ? blockToTree(stmt.else_)
            : stmtToTree(stmt.else_),
        );
      }
      return { label: "If", span: stmt.span, children };
    }
    case "While":
      return {
        label: "While",
        span: stmt.span,
        children: [exprToTree(stmt.cond), blockToTree(stmt.body)],
      };
    case "Return":
      return {
        label: "Return",
        span: stmt.span,
        children: stmt.value ? [exprToTree(stmt.value)] : [],
      };
    case "ExprStmt":
      return {
        label: "ExprStmt",
        span: stmt.span,
        children: [exprToTree(stmt.expr)],
      };
    case "Block":
      return blockToTree(stmt);
    default: {
      const _exhaustive: never = stmt;
      return {
        label: `Unknown(${(_exhaustive as Stmt).kind})`,
        children: [],
      };
    }
  }
}

function blockToTree(block: Block): TreeNode {
  return {
    label: "Block",
    span: block.span,
    children: block.statements.map(stmtToTree),
  };
}

function paramToTree(param: Param): TreeNode {
  return {
    label: "Param",
    detail: param.name,
    span: param.span,
    children: [typeToTree(param.type)],
  };
}

function functionToTree(fn: FunctionDecl): TreeNode {
  const children: TreeNode[] = [
    ...fn.params.map(paramToTree),
  ];
  if (fn.returnType) {
    children.push(typeToTree(fn.returnType));
  }
  children.push(blockToTree(fn.body));
  return {
    label: "Function",
    detail: fn.name,
    span: fn.span,
    children,
  };
}

/** Convert a Program AST into a collapsible TreeNode hierarchy. */
export function astToTree(program: Program): TreeNode {
  return {
    label: "Program",
    children: program.functions.map(functionToTree),
  };
}
