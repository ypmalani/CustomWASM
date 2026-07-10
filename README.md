# CustomWASM Compiler

A statically typed language compiled to WebAssembly Text (WAT) by a TypeScript compiler, encoded with `wabt.js`, and executed client-side.

## Phase 1 — Walking Skeleton

Lexer, recursive-descent parser with precedence climbing, and direct AST → WAT codegen for the minimal subset: `let` with `i32`, arithmetic (`+ - * / %`), and `fn main() -> i32`.

### Setup

```bash
npm install
npm run typecheck
npm test
```

### Exit criteria

```
fn main() -> i32 { let x = 2 + 3 * 4; return x; }
```

compiles, validates through `wat2wasm`, and returns `14`.
