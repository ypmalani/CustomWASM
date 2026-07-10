# CustomWASM Compiler

A statically typed language compiled to WebAssembly Text (WAT) by a TypeScript compiler, encoded with `wabt.js`, and executed client-side in a React playground.

## Setup

```bash
npm install
npm run typecheck
npm test
npm run dev
```

## Docs

Regenerate the playground language reference from the EBNF in `.cursor/memory/architecture.md`:

```bash
npm run docs:generate
```

Open the **Docs** tab in the playground for the language reference and memory-layout diagram.

## Exit criteria (Phase 1)

```
fn main() -> i32 { let x = 2 + 3 * 4; return x; }
```

compiles, validates through `wat2wasm`, and returns `14`.
