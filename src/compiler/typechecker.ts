import type {
  BinOp,
  Block,
  Expr,
  FunctionDecl,
  Program,
  Stmt,
} from "./ast.js";
import type { Diagnostic } from "./diagnostics.js";
import type { Span } from "./token.js";
import type {
  BindingRef,
  TypedBlock,
  TypedExpr,
  TypedFunctionDecl,
  TypedParam,
  TypedProgram,
  TypedStmt,
} from "./typed-ast.js";
import {
  TY_BOOL,
  TY_ERROR,
  TY_F64,
  TY_I32,
  TY_STRING,
  TY_VOID,
  typeEquals,
  typeNodeToType,
  typeToString,
  type Type,
} from "./types.js";

export interface CheckResult {
  typedProgram: TypedProgram | null;
  diagnostics: Diagnostic[];
}

interface FuncSig {
  params: Type[];
  result: Type;
  span: Span;
}

interface Binding {
  type: Type;
  kind: "param" | "local";
}

type ScopeStack = Array<Map<string, Binding>>;

interface CheckCtx {
  diagnostics: Diagnostic[];
  signatures: Map<string, FuncSig>;
  scopes: ScopeStack;
  /** Declared return type of the function currently being checked. */
  expectedReturn: Type;
  /** Name of the function currently being checked (for diagnostics). */
  currentFn: string;
}

/**
 * Type-check a Program AST.
 * Builds a function-signature table in a pre-pass (forward refs / recursion),
 * then walks each function with chained hash-map scopes, enforcing the static
 * rules from architecture.md. Collects diagnostics and never throws for
 * user-level type errors. Returns a parallel typed AST when checking completes
 * (typedProgram is still produced even with errors, annotated with error types).
 */
export function check(program: Program): CheckResult {
  const diagnostics: Diagnostic[] = [];
  const signatures = buildSignatures(program, diagnostics);

  // Require fn main() -> i32
  const mainSig = signatures.get("main");
  if (!mainSig) {
    diagnostics.push({
      message: "program must define 'fn main() -> i32'",
      span: { start: 0, end: 0, line: 1, col: 1 },
      severity: "error",
    });
  } else if (
    mainSig.params.length !== 0 ||
    !typeEquals(mainSig.result, TY_I32) ||
    mainSig.result.kind === "error"
  ) {
    // Only diagnose signature shape when main exists but is wrong.
    // Avoid double-reporting if result was already error from a bad TypeNode.
    if (mainSig.params.length !== 0 || mainSig.result.kind !== "i32") {
      diagnostics.push({
        message: "function 'main' must have signature '() -> i32'",
        span: mainSig.span,
        severity: "error",
      });
    }
  }

  const functions: TypedFunctionDecl[] = [];
  for (const fn of program.functions) {
    functions.push(checkFunction(fn, signatures, diagnostics));
  }

  const typedProgram: TypedProgram = { kind: "Program", functions };
  return {
    typedProgram: diagnostics.length === 0 ? typedProgram : null,
    diagnostics,
  };
}

function buildSignatures(
  program: Program,
  diagnostics: Diagnostic[],
): Map<string, FuncSig> {
  const signatures = new Map<string, FuncSig>();
  for (const fn of program.functions) {
    if (signatures.has(fn.name)) {
      diagnostics.push({
        message: `function '${fn.name}' is already declared`,
        span: fn.span,
        severity: "error",
      });
      continue;
    }
    const params = fn.params.map((p) => typeNodeToType(p.type));
    const result = fn.returnType ? typeNodeToType(fn.returnType) : TY_VOID;
    signatures.set(fn.name, { params, result, span: fn.span });
  }
  return signatures;
}

function checkFunction(
  fn: FunctionDecl,
  signatures: Map<string, FuncSig>,
  diagnostics: Diagnostic[],
): TypedFunctionDecl {
  const sig = signatures.get(fn.name)!;
  const scopes: ScopeStack = [new Map()];

  // Seed params into the outermost scope; diagnose duplicate param names.
  const typedParams: TypedParam[] = [];
  for (let i = 0; i < fn.params.length; i++) {
    const p = fn.params[i]!;
    const resolvedType = sig.params[i]!;
    if (scopes[0]!.has(p.name)) {
      diagnostics.push({
        message: `variable '${p.name}' is already declared in this scope`,
        span: p.span,
        severity: "error",
      });
    } else {
      scopes[0]!.set(p.name, { type: resolvedType, kind: "param" });
    }
    typedParams.push({
      name: p.name,
      type: p.type,
      resolvedType,
      span: p.span,
    });
  }

  const ctx: CheckCtx = {
    diagnostics,
    signatures,
    scopes,
    expectedReturn: sig.result,
    currentFn: fn.name,
  };

  const body = checkBlock(fn.body, ctx);

  // Definite-return analysis for non-void functions.
  if (sig.result.kind !== "void" && sig.result.kind !== "error") {
    if (!definitelyReturns(body)) {
      diagnostics.push({
        message: `function '${fn.name}' must return '${typeToString(sig.result)}' on all paths`,
        span: fn.span,
        severity: "error",
      });
    }
  }

  return {
    kind: "Function",
    name: fn.name,
    params: typedParams,
    returnType: fn.returnType,
    resolvedReturnType: sig.result,
    body,
    span: fn.span,
  };
}

// ---- Definite return analysis ----

function definitelyReturns(stmt: TypedStmt): boolean {
  switch (stmt.kind) {
    case "Return":
      return true;
    case "Block": {
      // A block definitely returns if any statement does (control after return
      // is unreachable) — but conservatively we require the *last* statement,
      // or an if/else that covers both arms. Per architecture.md: a block
      // "definitely returns" if it ends in return or an if/else where both
      // arms definitely return. Walk: if any prefix statement is a Return or
      // a covering If, the block returns; trailing stmts after that are dead.
      for (const s of stmt.statements) {
        if (definitelyReturns(s)) return true;
      }
      return false;
    }
    case "If": {
      if (!stmt.else_) return false;
      return definitelyReturns(stmt.then) && definitelyReturns(stmt.else_);
    }
    case "While":
    case "Let":
    case "Assign":
    case "ExprStmt":
      return false;
    default: {
      const _exhaustive: never = stmt;
      void _exhaustive;
      return false;
    }
  }
}

// ---- Scopes ----

function pushScope(ctx: CheckCtx): void {
  ctx.scopes.push(new Map());
}

function popScope(ctx: CheckCtx): void {
  ctx.scopes.pop();
}

function lookup(name: string, scopes: ScopeStack): Binding | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const b = scopes[i]!.get(name);
    if (b !== undefined) return b;
  }
  return undefined;
}

function error(ctx: CheckCtx, message: string, span: Span): void {
  ctx.diagnostics.push({ message, span, severity: "error" });
}

// ---- Statements ----

function checkBlock(block: Block, ctx: CheckCtx): TypedBlock {
  pushScope(ctx);
  const statements: TypedStmt[] = [];
  for (const stmt of block.statements) {
    statements.push(checkStmt(stmt, ctx));
  }
  popScope(ctx);
  return { kind: "Block", statements, span: block.span };
}

function checkStmt(stmt: Stmt, ctx: CheckCtx): TypedStmt {
  switch (stmt.kind) {
    case "Let": {
      const init = checkExpr(stmt.init, ctx);
      let bindingType: Type = init.type;
      if (stmt.declaredType) {
        const declared = typeNodeToType(stmt.declaredType);
        if (!typeEquals(declared, init.type)) {
          error(
            ctx,
            `declared type '${typeToString(declared)}' does not match initializer type '${typeToString(init.type)}'`,
            stmt.span,
          );
          bindingType = TY_ERROR;
        } else {
          bindingType = declared.kind === "error" ? init.type : declared;
        }
      }
      // Redeclaration in the same (innermost) scope is an error.
      const innermost = ctx.scopes[ctx.scopes.length - 1]!;
      if (innermost.has(stmt.name)) {
        error(
          ctx,
          `variable '${stmt.name}' is already declared in this scope`,
          stmt.span,
        );
      } else {
        innermost.set(stmt.name, { type: bindingType, kind: "local" });
      }
      return {
        kind: "Let",
        name: stmt.name,
        declaredType: stmt.declaredType,
        init,
        span: stmt.span,
        type: bindingType,
      };
    }
    case "Assign": {
      const value = checkExpr(stmt.value, ctx);
      if (stmt.target.kind === "Identifier") {
        const binding = lookup(stmt.target.name, ctx.scopes);
        if (!binding) {
          error(
            ctx,
            `undefined variable '${stmt.target.name}'`,
            stmt.target.span,
          );
          const target: TypedExpr = {
            kind: "Identifier",
            name: stmt.target.name,
            span: stmt.target.span,
            type: TY_ERROR,
            binding: null,
          };
          return { kind: "Assign", target, value, span: stmt.span };
        }
        if (!typeEquals(binding.type, value.type)) {
          error(
            ctx,
            `cannot assign '${typeToString(value.type)}' to variable '${stmt.target.name}' of type '${typeToString(binding.type)}'`,
            stmt.span,
          );
        }
        const target: TypedExpr = {
          kind: "Identifier",
          name: stmt.target.name,
          span: stmt.target.span,
          type: binding.type,
          binding: { name: stmt.target.name, kind: binding.kind },
        };
        return { kind: "Assign", target, value, span: stmt.span };
      }
      // Indexed assignment: type-check both sides; element type must match.
      const target = checkExpr(stmt.target, ctx);
      if (
        target.kind === "Index" &&
        !typeEquals(target.type, value.type) &&
        target.type.kind !== "error" &&
        value.type.kind !== "error"
      ) {
        error(
          ctx,
          `cannot assign '${typeToString(value.type)}' to element of type '${typeToString(target.type)}'`,
          stmt.span,
        );
      }
      return { kind: "Assign", target, value, span: stmt.span };
    }
    case "If": {
      const cond = checkExpr(stmt.cond, ctx);
      if (!typeEquals(cond.type, TY_BOOL)) {
        error(
          ctx,
          `condition must be 'bool', found '${typeToString(cond.type)}'`,
          stmt.cond.span,
        );
      }
      const then = checkBlock(stmt.then, ctx);
      let else_: TypedBlock | TypedStmt | undefined;
      if (stmt.else_) {
        if (stmt.else_.kind === "Block") {
          else_ = checkBlock(stmt.else_, ctx);
        } else {
          else_ = checkStmt(stmt.else_, ctx);
        }
      }
      return { kind: "If", cond, then, else_, span: stmt.span };
    }
    case "While": {
      const cond = checkExpr(stmt.cond, ctx);
      if (!typeEquals(cond.type, TY_BOOL)) {
        error(
          ctx,
          `condition must be 'bool', found '${typeToString(cond.type)}'`,
          stmt.cond.span,
        );
      }
      const body = checkBlock(stmt.body, ctx);
      return { kind: "While", cond, body, span: stmt.span };
    }
    case "Return": {
      if (stmt.value) {
        const value = checkExpr(stmt.value, ctx);
        if (ctx.expectedReturn.kind === "void") {
          error(
            ctx,
            `function '${ctx.currentFn}' has no return type but returns a value`,
            stmt.span,
          );
        } else if (!typeEquals(ctx.expectedReturn, value.type)) {
          error(
            ctx,
            `function '${ctx.currentFn}' must return '${typeToString(ctx.expectedReturn)}', found '${typeToString(value.type)}'`,
            stmt.span,
          );
        }
        return { kind: "Return", value, span: stmt.span };
      }
      // Bare return;
      if (ctx.expectedReturn.kind !== "void" && ctx.expectedReturn.kind !== "error") {
        error(
          ctx,
          `function '${ctx.currentFn}' must return '${typeToString(ctx.expectedReturn)}', found 'void'`,
          stmt.span,
        );
      }
      return { kind: "Return", span: stmt.span };
    }
    case "ExprStmt": {
      const expr = checkExpr(stmt.expr, ctx);
      return { kind: "ExprStmt", expr, span: stmt.span };
    }
    case "Block":
      return checkBlock(stmt, ctx);
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `typechecker: unhandled statement ${(_exhaustive as Stmt).kind}`,
      );
    }
  }
}

// ---- Expressions ----

function checkExpr(expr: Expr, ctx: CheckCtx): TypedExpr {
  switch (expr.kind) {
    case "IntLiteral":
      return { kind: "IntLiteral", value: expr.value, span: expr.span, type: TY_I32 };
    case "FloatLiteral":
      return {
        kind: "FloatLiteral",
        value: expr.value,
        span: expr.span,
        type: TY_F64,
      };
    case "BoolLiteral":
      return {
        kind: "BoolLiteral",
        value: expr.value,
        span: expr.span,
        type: TY_BOOL,
      };
    case "StringLiteral":
      return {
        kind: "StringLiteral",
        value: expr.value,
        span: expr.span,
        type: TY_STRING,
      };
    case "ArrayLiteral": {
      const elements = expr.elements.map((e) => checkExpr(e, ctx));
      if (elements.length === 0) {
        // Empty array: cannot infer element type; use error.
        error(ctx, "cannot infer type of empty array literal", expr.span);
        return {
          kind: "ArrayLiteral",
          elements,
          span: expr.span,
          type: TY_ERROR,
        };
      }
      const elemType = elements[0]!.type;
      for (let i = 1; i < elements.length; i++) {
        if (!typeEquals(elemType, elements[i]!.type)) {
          error(
            ctx,
            `array element type mismatch: expected '${typeToString(elemType)}', found '${typeToString(elements[i]!.type)}'`,
            elements[i]!.span,
          );
        }
      }
      const arrayType: Type =
        elemType.kind === "error"
          ? TY_ERROR
          : { kind: "array", element: elemType };
      return {
        kind: "ArrayLiteral",
        elements,
        span: expr.span,
        type: arrayType,
      };
    }
    case "Identifier": {
      const binding = lookup(expr.name, ctx.scopes);
      if (!binding) {
        error(ctx, `undefined variable '${expr.name}'`, expr.span);
        return {
          kind: "Identifier",
          name: expr.name,
          span: expr.span,
          type: TY_ERROR,
          binding: null,
        };
      }
      const ref: BindingRef = { name: expr.name, kind: binding.kind };
      return {
        kind: "Identifier",
        name: expr.name,
        span: expr.span,
        type: binding.type,
        binding: ref,
      };
    }
    case "Unary": {
      const operand = checkExpr(expr.operand, ctx);
      if (expr.op === "!") {
        if (!typeEquals(operand.type, TY_BOOL)) {
          error(
            ctx,
            `condition must be 'bool', found '${typeToString(operand.type)}'`,
            expr.operand.span,
          );
          return {
            kind: "Unary",
            op: "!",
            operand,
            span: expr.span,
            type: TY_ERROR,
          };
        }
        return {
          kind: "Unary",
          op: "!",
          operand,
          span: expr.span,
          type: TY_BOOL,
        };
      }
      // Unary minus: i32 or f64 only
      if (
        operand.type.kind !== "i32" &&
        operand.type.kind !== "f64" &&
        operand.type.kind !== "error"
      ) {
        error(
          ctx,
          `unary '-' requires a numeric operand, found '${typeToString(operand.type)}'`,
          expr.operand.span,
        );
        return {
          kind: "Unary",
          op: "-",
          operand,
          span: expr.span,
          type: TY_ERROR,
        };
      }
      return {
        kind: "Unary",
        op: "-",
        operand,
        span: expr.span,
        type: operand.type.kind === "error" ? TY_ERROR : operand.type,
      };
    }
    case "Binary": {
      const left = checkExpr(expr.left, ctx);
      const right = checkExpr(expr.right, ctx);
      return checkBinary(expr.op, left, right, expr.span, ctx);
    }
    case "Call": {
      const args = expr.args.map((a) => checkExpr(a, ctx));
      const sig = ctx.signatures.get(expr.callee);
      if (!sig) {
        error(ctx, `undefined function '${expr.callee}'`, expr.span);
        return {
          kind: "Call",
          callee: expr.callee,
          args,
          span: expr.span,
          type: TY_ERROR,
        };
      }
      if (args.length !== sig.params.length) {
        error(
          ctx,
          `function '${expr.callee}' expects ${sig.params.length} arguments, found ${args.length}`,
          expr.span,
        );
      }
      const n = Math.min(args.length, sig.params.length);
      for (let i = 0; i < n; i++) {
        if (!typeEquals(sig.params[i]!, args[i]!.type)) {
          error(
            ctx,
            `argument ${i + 1} of '${expr.callee}' expects '${typeToString(sig.params[i]!)}', found '${typeToString(args[i]!.type)}'`,
            args[i]!.span,
          );
        }
      }
      return {
        kind: "Call",
        callee: expr.callee,
        args,
        span: expr.span,
        type: sig.result,
      };
    }
    case "Index": {
      const target = checkExpr(expr.target, ctx);
      const index = checkExpr(expr.index, ctx);
      if (!typeEquals(index.type, TY_I32)) {
        error(
          ctx,
          `index must be 'i32', found '${typeToString(index.type)}'`,
          expr.index.span,
        );
      }
      if (target.type.kind === "array") {
        return {
          kind: "Index",
          target,
          index,
          span: expr.span,
          type: target.type.element,
        };
      }
      if (target.type.kind === "string") {
        // String indexing yields i32 codepoint.
        return {
          kind: "Index",
          target,
          index,
          span: expr.span,
          type: TY_I32,
        };
      }
      if (target.type.kind !== "error") {
        error(
          ctx,
          `cannot index type '${typeToString(target.type)}'`,
          expr.target.span,
        );
      }
      return {
        kind: "Index",
        target,
        index,
        span: expr.span,
        type: TY_ERROR,
      };
    }
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `typechecker: unhandled expression ${(_exhaustive as Expr).kind}`,
      );
    }
  }
}

function checkBinary(
  op: BinOp,
  left: TypedExpr,
  right: TypedExpr,
  span: Span,
  ctx: CheckCtx,
): TypedExpr {
  // Logical
  if (op === "&&" || op === "||") {
    if (!typeEquals(left.type, TY_BOOL)) {
      error(
        ctx,
        `condition must be 'bool', found '${typeToString(left.type)}'`,
        left.span,
      );
    }
    if (!typeEquals(right.type, TY_BOOL)) {
      error(
        ctx,
        `condition must be 'bool', found '${typeToString(right.type)}'`,
        right.span,
      );
    }
    return { kind: "Binary", op, left, right, span, type: TY_BOOL };
  }

  // Equality: matching numeric OR bool pairs
  if (op === "==" || op === "!=") {
    const leftNum = left.type.kind === "i32" || left.type.kind === "f64";
    const rightNum = right.type.kind === "i32" || right.type.kind === "f64";
    const leftErr = left.type.kind === "error";
    const rightErr = right.type.kind === "error";
    const leftBool = left.type.kind === "bool";
    const rightBool = right.type.kind === "bool";

    if (leftErr || rightErr) {
      return { kind: "Binary", op, left, right, span, type: TY_BOOL };
    }
    if (leftBool && rightBool) {
      return { kind: "Binary", op, left, right, span, type: TY_BOOL };
    }
    if (leftNum && rightNum && left.type.kind === right.type.kind) {
      return { kind: "Binary", op, left, right, span, type: TY_BOOL };
    }
    error(
      ctx,
      `operator '${op}' requires operands of the same type, found '${typeToString(left.type)}' and '${typeToString(right.type)}'`,
      span,
    );
    return { kind: "Binary", op, left, right, span, type: TY_ERROR };
  }

  // Comparisons: matching numeric only
  if (op === "<" || op === "<=" || op === ">" || op === ">=") {
    const leftNum = left.type.kind === "i32" || left.type.kind === "f64";
    const rightNum = right.type.kind === "i32" || right.type.kind === "f64";
    if (left.type.kind === "error" || right.type.kind === "error") {
      return { kind: "Binary", op, left, right, span, type: TY_BOOL };
    }
    if (leftNum && rightNum && left.type.kind === right.type.kind) {
      return { kind: "Binary", op, left, right, span, type: TY_BOOL };
    }
    error(
      ctx,
      `operator '${op}' requires operands of the same numeric type, found '${typeToString(left.type)}' and '${typeToString(right.type)}'`,
      span,
    );
    return { kind: "Binary", op, left, right, span, type: TY_ERROR };
  }

  // Arithmetic: + - * / %
  if (op === "+" || op === "-" || op === "*" || op === "/" || op === "%") {
    if (left.type.kind === "error" || right.type.kind === "error") {
      return { kind: "Binary", op, left, right, span, type: TY_ERROR };
    }
    if (op === "%") {
      // % is i32-only
      if (left.type.kind === "i32" && right.type.kind === "i32") {
        return { kind: "Binary", op, left, right, span, type: TY_I32 };
      }
      error(
        ctx,
        `operator '%' requires operands of type 'i32', found '${typeToString(left.type)}' and '${typeToString(right.type)}'`,
        span,
      );
      return { kind: "Binary", op, left, right, span, type: TY_ERROR };
    }
    const leftNum = left.type.kind === "i32" || left.type.kind === "f64";
    const rightNum = right.type.kind === "i32" || right.type.kind === "f64";
    if (leftNum && rightNum && left.type.kind === right.type.kind) {
      return {
        kind: "Binary",
        op,
        left,
        right,
        span,
        type: left.type,
      };
    }
    error(
      ctx,
      `operator '${op}' requires operands of the same numeric type, found '${typeToString(left.type)}' and '${typeToString(right.type)}'`,
      span,
    );
    return { kind: "Binary", op, left, right, span, type: TY_ERROR };
  }

  const _exhaustive: never = op;
  throw new Error(`typechecker: unhandled operator '${_exhaustive}'`);
}
