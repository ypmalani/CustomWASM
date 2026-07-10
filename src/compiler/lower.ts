import type { BinOp } from "./ast.js";
import type {
  IRBinOp,
  IRExpr,
  IRFunction,
  IRModule,
  IRStmt,
  WasmType,
} from "./ir.js";
import type {
  TypedBlock,
  TypedExpr,
  TypedFunctionDecl,
  TypedProgram,
  TypedStmt,
} from "./typed-ast.js";
import type { Type } from "./types.js";

/**
 * Lower a well-typed AST to the tree-structured IR.
 * Total on well-typed input: any failure is a compiler bug and throws.
 * Never diagnoses — the type checker already passed.
 */

type ScopeStack = Array<Map<string, number>>;

interface LowerCtx {
  /** Name → dense local index (params first, then lets in DFS order). */
  scopes: ScopeStack;
  /** Next free local index (continues after params). */
  nextLocalIndex: number;
  /** Wasm types of locals (not including params). */
  locals: WasmType[];
  /** Function name → module function index. */
  funcIndices: Map<string, number>;
  /** Function name → whether it has a result (for Drop vs CallStmt). */
  funcHasResult: Map<string, boolean>;
  /**
   * Enclosing label stack for relative branch depths.
   * Index 0 is the innermost label; relative depth = distance from top.
   */
  labelStack: number[];
}

export function lower(typed: TypedProgram): IRModule {
  const funcIndices = new Map<string, number>();
  const funcHasResult = new Map<string, boolean>();
  for (let i = 0; i < typed.functions.length; i++) {
    const fn = typed.functions[i]!;
    funcIndices.set(fn.name, i);
    funcHasResult.set(fn.name, fn.resolvedReturnType.kind !== "void");
  }

  const functions = typed.functions.map((fn) =>
    lowerFunction(fn, funcIndices, funcHasResult),
  );

  return {
    functions,
    imports: [],
    dataSegments: [],
    memoryPages: 1,
    heapBase: 1024,
  };
}

function lowerFunction(
  fn: TypedFunctionDecl,
  funcIndices: Map<string, number>,
  funcHasResult: Map<string, boolean>,
): IRFunction {
  const params: WasmType[] = fn.params.map((p) => typeToWasm(p.resolvedType));
  const scopes: ScopeStack = [new Map()];
  for (let i = 0; i < fn.params.length; i++) {
    scopes[0]!.set(fn.params[i]!.name, i);
  }

  const ctx: LowerCtx = {
    scopes,
    nextLocalIndex: fn.params.length,
    locals: [],
    funcIndices,
    funcHasResult,
    labelStack: [],
  };

  const body = lowerBlockStmts(fn.body, ctx);

  const result =
    fn.resolvedReturnType.kind === "void"
      ? undefined
      : typeToWasm(fn.resolvedReturnType);

  // Trailing unreachable so WASM validation accepts the function end when
  // the last statement is an if/while whose arms return (control never falls
  // through, but the type checker still wants an i32 or an unreachable end).
  if (result !== undefined) {
    body.push({ kind: "Unreachable" });
  }

  return {
    name: fn.name,
    params,
    locals: ctx.locals,
    result,
    body,
    exported: fn.name === "main",
  };
}

function typeToWasm(t: Type): WasmType {
  switch (t.kind) {
    case "i32":
    case "bool":
      return "i32";
    case "f64":
      return "f64";
    case "string":
    case "array":
      // Pointers into linear memory (Phase 7); treat as i32 for now.
      return "i32";
    case "void":
      throw new Error("lower: cannot map void to WasmType");
    case "error":
      throw new Error("lower: unexpected error type in well-typed AST");
    default: {
      const _exhaustive: never = t;
      throw new Error(`lower: unhandled type ${(_exhaustive as Type).kind}`);
    }
  }
}

function resolveLocal(name: string, scopes: ScopeStack): number {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const idx = scopes[i]!.get(name);
    if (idx !== undefined) return idx;
  }
  throw new Error(`lower: unbound identifier '${name}'`);
}

/** Relative depth of a label: 0 = innermost. */
function relativeDepth(ctx: LowerCtx, label: number): number {
  for (let i = ctx.labelStack.length - 1; i >= 0; i--) {
    if (ctx.labelStack[i] === label) {
      return ctx.labelStack.length - 1 - i;
    }
  }
  throw new Error(`lower: label ${label} not on label stack`);
}

function pushScope(ctx: LowerCtx): void {
  ctx.scopes.push(new Map());
}

function popScope(ctx: LowerCtx): void {
  ctx.scopes.pop();
}

// ---- Statements ----

function lowerBlockStmts(block: TypedBlock, ctx: LowerCtx): IRStmt[] {
  pushScope(ctx);
  const stmts: IRStmt[] = [];
  for (const stmt of block.statements) {
    stmts.push(...lowerStmt(stmt, ctx));
  }
  popScope(ctx);
  return stmts;
}

function lowerStmt(stmt: TypedStmt, ctx: LowerCtx): IRStmt[] {
  switch (stmt.kind) {
    case "Let": {
      const value = lowerExpr(stmt.init, ctx);
      const index = ctx.nextLocalIndex++;
      ctx.locals.push(typeToWasm(stmt.type));
      ctx.scopes[ctx.scopes.length - 1]!.set(stmt.name, index);
      return [{ kind: "LocalSet", index, value }];
    }
    case "Assign": {
      if (stmt.target.kind !== "Identifier") {
        throw new Error("lower: indexed assignment is not supported");
      }
      const value = lowerExpr(stmt.value, ctx);
      const index = resolveLocal(stmt.target.name, ctx.scopes);
      return [{ kind: "LocalSet", index, value }];
    }
    case "If": {
      const cond = lowerExpr(stmt.cond, ctx);
      const then = lowerBlockStmts(stmt.then, ctx);
      let else_: IRStmt[] | undefined;
      if (stmt.else_) {
        if (stmt.else_.kind === "Block") {
          else_ = lowerBlockStmts(stmt.else_, ctx);
        } else {
          // Chained else-if: lower as nested IfStmt inside the else arm.
          else_ = lowerStmt(stmt.else_, ctx);
        }
      }
      return [{ kind: "IfStmt", cond, then, else_ }];
    }
    case "While": {
      // Canonical lowering:
      //   Block L_exit {
      //     Loop L_head {
      //       BrIf(!c, target: L_exit)
      //       ...body...
      //       Br(target: L_head)
      //     }
      //   }
      const L_exit = 0; // label ids are just markers; relative depth is computed
      const L_head = 1;

      ctx.labelStack.push(L_exit);
      ctx.labelStack.push(L_head);

      const cond = lowerExpr(stmt.cond, ctx);
      const exitDepth = relativeDepth(ctx, L_exit);
      const headDepth = relativeDepth(ctx, L_head);

      const loopBody: IRStmt[] = [
        {
          kind: "BrIf",
          cond: { kind: "UnOp", type: "i32", op: "eqz", operand: cond },
          target: exitDepth,
        },
        ...lowerBlockStmts(stmt.body, ctx),
        { kind: "Br", target: headDepth },
      ];

      ctx.labelStack.pop(); // L_head
      ctx.labelStack.pop(); // L_exit

      return [
        {
          kind: "Block",
          label: L_exit,
          body: [{ kind: "Loop", label: L_head, body: loopBody }],
        },
      ];
    }
    case "Return": {
      if (stmt.value) {
        return [{ kind: "Return", value: lowerExpr(stmt.value, ctx) }];
      }
      return [{ kind: "Return" }];
    }
    case "ExprStmt": {
      // Void calls become CallStmt; everything else is Drop'd.
      if (stmt.expr.kind === "Call") {
        const hasResult = ctx.funcHasResult.get(stmt.expr.callee);
        if (hasResult === undefined) {
          throw new Error(`lower: unknown function '${stmt.expr.callee}'`);
        }
        if (!hasResult) {
          const funcIndex = ctx.funcIndices.get(stmt.expr.callee);
          if (funcIndex === undefined) {
            throw new Error(`lower: unknown function '${stmt.expr.callee}'`);
          }
          const args = stmt.expr.args.map((a) => lowerExpr(a, ctx));
          return [{ kind: "CallStmt", funcIndex, args }];
        }
      }
      return [{ kind: "Drop", value: lowerExpr(stmt.expr, ctx) }];
    }
    case "Block":
      return lowerBlockStmts(stmt, ctx);
    default: {
      const _exhaustive: never = stmt;
      throw new Error(
        `lower: unhandled statement ${(_exhaustive as TypedStmt).kind}`,
      );
    }
  }
}

// ---- Expressions ----

function lowerExpr(expr: TypedExpr, ctx: LowerCtx): IRExpr {
  switch (expr.kind) {
    case "IntLiteral":
      return { kind: "Const", type: "i32", value: expr.value };
    case "BoolLiteral":
      return { kind: "Const", type: "i32", value: expr.value ? 1 : 0 };
    case "FloatLiteral":
      return { kind: "Const", type: "f64", value: expr.value };
    case "Identifier": {
      const index = resolveLocal(expr.name, ctx.scopes);
      return { kind: "LocalGet", type: typeToWasm(expr.type), index };
    }
    case "Unary": {
      const operand = lowerExpr(expr.operand, ctx);
      if (expr.op === "!") {
        return { kind: "UnOp", type: "i32", op: "eqz", operand };
      }
      // Unary minus
      return {
        kind: "UnOp",
        type: typeToWasm(expr.type),
        op: "neg",
        operand,
      };
    }
    case "Binary": {
      const left = lowerExpr(expr.left, ctx);
      const right = lowerExpr(expr.right, ctx);

      if (expr.op === "&&") {
        // Short-circuit: if left then right else 0
        return {
          kind: "IfExpr",
          type: "i32",
          cond: left,
          then: right,
          else_: { kind: "Const", type: "i32", value: 0 },
        };
      }
      if (expr.op === "||") {
        // Short-circuit: if left then 1 else right
        return {
          kind: "IfExpr",
          type: "i32",
          cond: left,
          then: { kind: "Const", type: "i32", value: 1 },
          else_: right,
        };
      }

      const op = binOpToIR(expr.op);
      // Comparison/equality results are bool → i32; arithmetic keeps operand type.
      const resultType = typeToWasm(expr.type);
      return { kind: "BinOp", type: resultType, op, left, right };
    }
    case "Call": {
      const funcIndex = ctx.funcIndices.get(expr.callee);
      if (funcIndex === undefined) {
        throw new Error(`lower: unknown function '${expr.callee}'`);
      }
      const args = expr.args.map((a) => lowerExpr(a, ctx));
      // Void calls in expression position shouldn't happen in well-typed AST
      // when used as CallExpr; CallStmt handles void. If result is void, use i32
      // placeholder — but type checker prevents void in value position for Drop.
      const resultType =
        expr.type.kind === "void" ? "i32" : typeToWasm(expr.type);
      return { kind: "CallExpr", type: resultType, funcIndex, args };
    }
    case "StringLiteral":
      throw new Error("lower: string literals are not supported (Phase 7)");
    case "ArrayLiteral":
      throw new Error("lower: array literals are not supported (Phase 7)");
    case "Index":
      throw new Error("lower: indexing is not supported (Phase 7)");
    default: {
      const _exhaustive: never = expr;
      throw new Error(
        `lower: unhandled expression ${(_exhaustive as TypedExpr).kind}`,
      );
    }
  }
}

function binOpToIR(op: BinOp): IRBinOp {
  switch (op) {
    case "+":
      return "add";
    case "-":
      return "sub";
    case "*":
      return "mul";
    case "/":
      return "div";
    case "%":
      return "rem";
    case "==":
      return "eq";
    case "!=":
      return "ne";
    case "<":
      return "lt";
    case "<=":
      return "le";
    case ">":
      return "gt";
    case ">=":
      return "ge";
    case "&&":
    case "||":
      // Handled specially in lowerExpr before this is called.
      throw new Error(`lower: ${op} should be desugared to IfExpr`);
    default: {
      const _exhaustive: never = op;
      throw new Error(`lower: unhandled operator '${_exhaustive}'`);
    }
  }
}
