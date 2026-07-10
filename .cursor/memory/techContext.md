# Tech Context — CustomWASM Compiler

## Stack Summary

| Concern | Choice |
|---|---|
| Compiler implementation | TypeScript (strict mode), no runtime deps |
| Frontend playground | React 18+, Vite, Tailwind CSS |
| WAT → WASM encoding | `wabt.js` (`wat2wasm`), in-browser and in tests |
| Execution | `WebAssembly.instantiate` in the browser |
| Tests | Vitest (compiler unit + end-to-end runtime tests) |
| State management | Light React state/context (no Redux/Zustand) |

## Language Compiler (TypeScript)

- **Strict TypeScript** (`strict: true`, `noUncheckedIndexedAccess`). AST and IR nodes are discriminated unions on a `kind` field so exhaustiveness is compiler-checked via `never` assertions.
- **Modular pipeline** — each stage is a pure function in its own module with a single entry point:
  - `src/compiler/lexer.ts` — `lex(source: string): Token[]`
  - `src/compiler/parser.ts` — `parse(tokens: Token[]): Program`
  - `src/compiler/typechecker.ts` — `check(ast: Program): { typedProgram: TypedProgram | null; diagnostics: Diagnostic[] }`
  - `src/compiler/lower.ts` — `lower(typed: TypedProgram): IRModule`
  - `src/compiler/optimizer/` — `optimize(ir: IRModule, passes: Pass[]): IRModule`
  - `src/compiler/codegen.ts` — `emit(ir: IRModule): string` (WAT text; walk lives in `watOps.ts`)
  - `src/compiler/stepper.ts` — `trace(ir: IRModule): TraceResult` (stack-machine observation over the same `WatOp[]` stream)
  - `src/compiler/pipeline.ts` — orchestrates all stages, returns every intermediate artifact for the UI.
- **Visitor pattern** for all tree traversals. One generic visitor interface per tree (AST, IR); passes implement only the node handlers they care about. No pass mutates its input tree — every transform returns a new tree.
- **Diagnostics, not exceptions:** stages return `Diagnostic { message, span, severity }` arrays; only internal invariant violations throw.

## Frontend Playground (React + Vite + Tailwind)

- Split-pane layout: source editor (left), tabbed inspector (right) with **AST | IR | Optimized IR | WAT | Stepper | Output | Docs** tabs. The Docs tab shows a grammar-generated language reference and a memory-layout diagram. The Stepper tab animates the WASM value stack from `trace(ir)` (no interpretation in the UI). The source editor is CodeMirror 6 with diagnostic squiggle underlines.
- Compilation runs on debounced (~300ms) source changes; execution only on explicit Run.
- Tailwind for all styling; no component library required. Collapsible tree view is a small recursive component shared by AST and IR tabs.
- The compiler is imported directly into the frontend as a workspace-local TypeScript module — same code runs in tests and browser.

## Binary Translation — `wabt.js`

- `wabt()` is async-initialized once at app startup and cached in a React context.
- Flow: `wabt.parseWat(filename, watText)` → `module.validate()` → `module.toBinary({})` → `WebAssembly.instantiate(buffer, imports)`.
- `wat2wasm` validation is the **semantic gate**: it verifies stack depth, local indices, and type usage — not just syntax. Every test that produces WAT must run it.
- Imports object provides `env.print_i32` / `env.print_str` (Phase 7+) wired to the playground output console.

## State Management

- One `PlaygroundContext` holding: `source`, and a `CompileResult` of `{ tokens, ast, typedAst, diagnostics, ir, optimizedIr, wat, runOutput }`.
- Derived artifacts are recomputed from `source` (via the pipeline) — never stored redundantly or edited independently.
- Run output is appended to a log array; cleared on each Run.

## Repository Layout

```
src/
  compiler/        # pure TS, no DOM/React imports allowed
    __tests__/     # unit + golden + runtime tests
  playground/      # React app (components, context, hooks)
.cursor/
  memory/          # projectbrief.md, techContext.md, architecture.md
  rules/           # lexer-parser.mdc, typechecker-ir.mdc, codegen-wasm.mdc
```

Hard boundary: `src/compiler/**` must never import from `src/playground/**` or reference browser globals, so it stays testable in Node.
