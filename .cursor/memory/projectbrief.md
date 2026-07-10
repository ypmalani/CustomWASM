# Project Brief — CustomWASM Compiler

A statically typed programming language, compiled to WebAssembly Text (WAT) by a TypeScript compiler, encoded to binary with `wabt.js`, and executed entirely client-side in a React playground.

## Overarching Goals

1. **End-to-end ownership:** Every pipeline stage (Lexer → Parser → Type Checker → IR → Optimizer → WAT Codegen → Browser Execution) is hand-written and inspectable in the playground UI.
2. **Interview-defensible architecture:** Each stage uses a well-known, explainable design (recursive descent, visitor pattern, symbol tables, tree-based IR, structured control flow lowering).
3. **Zero server dependency:** Compilation and execution happen in the browser. `wabt.js` performs `wat2wasm`; `WebAssembly.instantiate` runs the result.

## Success Metrics

- A program using `let`, `if/else`, `while`, functions, arithmetic, strings, and arrays compiles to WAT that passes `wat2wasm` validation with zero errors.
- Type errors are caught before codegen with source line/column and a human-readable message.
- The optimizer measurably reduces instruction count on benchmark programs (constant folding + dead code elimination), verified by golden-file tests.
- The playground renders source, AST, IR, and WAT side by side and updates live.
- Every phase ships with a test suite of `(input source → expected output)` cases that pass in CI.

## Roadmap

### Phase 1 — Walking Skeleton (Lexer, Parser, Basic WAT Codegen)
- Hand-written lexer producing tokens with source spans (`line`, `col`, `start`, `end`).
- Recursive descent parser with precedence climbing for expressions, producing the AST defined in `architecture.md`.
- Direct AST → WAT codegen for the minimal subset: `let` with `i32`, arithmetic (`+ - * / %`), and a `main` function exporting its result.
- Node-based test harness: compile source, run `wat2wasm` via `wabt.js`, instantiate, assert return values.
- **Exit criteria:** `let x = 2 + 3 * 4; return x;` executes and returns `14`.

### Phase 2 — Frontend & AST Visualizer
- React + Vite + Tailwind playground: split-pane layout (editor left; tabbed AST / WAT / output right).
- AST rendered as a collapsible tree that re-derives on debounced source changes; parse errors shown inline with source coordinates.
- `wabt.js` loaded in the browser; a Run button instantiates the module and prints results to an output console pane.
- **Exit criteria:** Typing source updates the AST tree live; Run executes the Phase 1 subset in-browser.

### Phase 3 — Core Language (Control Flow, Functions, Scoping)
- Parser + codegen for `if/else`, `while`, comparison and logical operators, function declarations with parameters and `return`, and lexically scoped blocks with shadowing.
- Codegen maps loops/conditionals directly to WASM structured control flow (`block`/`loop`/`br_if`) — no jump emulation.
- Locals resolved to WASM local indices via a scope-aware environment.
- **Exit criteria:** Recursive `fib(n)` and iterative loops compile, validate, and run correctly.

### Phase 4 — Type Checker
- A dedicated visitor pass over the AST, before codegen, producing a typed AST (every expression node annotated with a resolved `Type`).
- Chained hash-map symbol tables per lexical scope; function signature table built in a pre-pass to allow forward references.
- Enforcement rules per `architecture.md`: no implicit coercion, `bool` conditions only, arity/type-checked calls, return-type conformance, definite initialization via `let`.
- Diagnostics collected (not thrown) so the playground can show multiple errors at once.
- **Exit criteria:** A test corpus of ill-typed programs each produces the expected diagnostic; well-typed programs pass unchanged.

### Phase 5 — Intermediate Representation
- Introduce the typed, tree-structured IR defined in `architecture.md`: expressions remain trees; statements are structured control-flow nodes (`block`, `loop`, `if`, `br`, `br_if`) that map 1:1 onto WASM constructs.
- Lowering pass: typed AST → IR (desugars `while` into `block`+`loop`+`br_if`, resolves names to local indices, makes implicit drops explicit).
- Codegen retargeted: IR → WAT via post-order emission onto the stack machine. AST is no longer a codegen input.
- **Exit criteria:** All Phase 3/4 tests pass through the new AST → IR → WAT path with identical runtime behavior.

### Phase 6 — Optimizer
- Optimization passes as pure `IRModule → IRModule` functions, run in a configurable pipeline until fixpoint or a pass budget:
  - **Constant folding:** evaluate constant-operand expression subtrees at compile time (with trap-preserving semantics: never fold division by zero).
  - **Dead code elimination:** remove statements after `return`/`br`, `if` branches with constant conditions, and unreferenced locals.
- Playground shows unoptimized vs. optimized IR diff and instruction counts.
- **Exit criteria:** Golden tests assert exact optimized IR for benchmark inputs; semantics preserved on the full runtime suite.

### Phase 7 — Advanced Types & Memory Allocator
- `string` and `T[]` types backed by WASM linear memory using the bump allocator layout in `architecture.md` (heap base at 1024, 8-byte alignment, `[length:i32][data...]` headers).
- String literals placed in a static data segment; array literals and `new` arrays heap-allocated at runtime; bounds-checked indexing that traps via `unreachable`.
- Host imports (`env.print_i32`, `env.print_str`) for observable output in the playground console.
- **Exit criteria:** Programs that build strings/arrays, index them, and print results run correctly; out-of-bounds access traps.

### Phase 8 — Polish & Stretch Goals
- Error UX: squiggle underlines in the editor, "expected X, found Y" recovery-quality parse errors.
- Documentation: language reference generated from the grammar; memory layout diagram in the playground.
- Stretch (pick per remaining time): free-list allocator upgrade (replacing bump-only), `for` loops, `else if` chains as sugar, source-map-style WAT ↔ source highlighting, additional passes (copy propagation, strength reduction).

## Workflow Mandates

- **Fresh context per phase:** Each phase starts a new agent session. The agent must first read `.cursor/memory/projectbrief.md`, `techContext.md`, and `architecture.md` to rehydrate context. Never rely on chat history from a prior phase.
- **Explainability (resume requirement):** Every phase's PR/commit message MUST explain the core algorithm implemented (e.g., "precedence climbing: each level parses operators of one precedence and recurses tighter") in 3–8 sentences, so the developer can defend the design in interviews without rereading code.
- **Validation gates:** No phase is complete until its tests pass AND all generated WAT validates through `wat2wasm` (see `.cursor/rules/*.mdc`).
- **Memory upkeep:** If a phase changes an interface defined in `architecture.md`, the agent must update that file in the same PR.
