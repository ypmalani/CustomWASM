import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
  type DecorationSet,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { Diagnostic } from "../../compiler/diagnostics.js";
import { usePlayground } from "../context/PlaygroundContext.js";
import {
  diagnosticsToRanges,
  rangesToDecorations,
} from "../lib/diagnosticDecorations.js";

const setDiagnosticsEffect = StateEffect.define<Diagnostic[]>();

const diagnosticField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiagnosticsEffect)) {
        const ranges = diagnosticsToRanges(e.value, tr.state.doc.length);
        return rangesToDecorations(ranges);
      }
    }
    if (tr.docChanged) {
      return deco.map(tr.changes);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "0.875rem",
      backgroundColor: "#0f172a",
      color: "#f1f5f9",
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      lineHeight: "1.5",
    },
    ".cm-content": {
      padding: "1rem 0",
      caretColor: "#e2e8f0",
    },
    ".cm-gutters": {
      backgroundColor: "#0f172a",
      color: "#64748b",
      border: "none",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1e293b",
    },
    ".cm-activeLine": {
      backgroundColor: "#1e293b66",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#e2e8f0",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#334155",
    },
    ".cm-diagnostic-error": {
      textDecoration: "underline wavy #f87171",
      textUnderlineOffset: "3px",
    },
    ".cm-diagnostic-warning": {
      textDecoration: "underline wavy #fbbf24",
      textUnderlineOffset: "3px",
    },
  },
  { dark: true },
);

function buildExtensions(onChange: (value: string) => void): Extension[] {
  return [
    lineNumbers(),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    placeholder("Write CustomWASM source…"),
    editorTheme,
    diagnosticField,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange(update.state.doc.toString());
      }
    }),
    EditorView.domEventHandlers({
      // Keep focus ring off to match prior textarea look
    }),
  ];
}

export function Editor() {
  const { source, setSource, result } = usePlayground();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setSourceRef = useRef(setSource);
  setSourceRef.current = setSource;

  // Mount once
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const state = EditorState.create({
      doc: source,
      extensions: buildExtensions((value) => setSourceRef.current(value)),
    });
    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once with initial source
  }, []);

  // External source sync (e.g. tests / future reset)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === source) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: source },
    });
  }, [source]);

  // Diagnostic squiggles from debounced compile result
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: setDiagnosticsEffect.of(result.diagnostics),
    });
  }, [result.diagnostics]);

  return (
    <div
      ref={hostRef}
      aria-label="Source editor"
      data-testid="source-editor"
      className="h-full w-full overflow-hidden bg-slate-900"
    />
  );
}
