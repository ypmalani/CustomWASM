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
      backgroundColor: "#12181F",
      color: "#E8EDF5",
    },
    "&.cm-focused": {
      outline: "2px solid #4ADEA8",
      outlineOffset: "-2px",
    },
    ".cm-scroller": {
      fontFamily:
        '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      lineHeight: "1.55",
    },
    ".cm-content": {
      padding: "1rem 0",
      caretColor: "#E8EDF5",
    },
    ".cm-gutters": {
      backgroundColor: "#12181F",
      color: "#6B7C93",
      border: "none",
      borderRight: "1px solid #243041",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#1a222d",
      color: "#8BA4C7",
    },
    ".cm-activeLine": {
      backgroundColor: "#1a222d66",
    },
    "&.cm-focused .cm-cursor": {
      borderLeftColor: "#4ADEA8",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
      backgroundColor: "#243041",
    },
    ".cm-diagnostic-error": {
      textDecoration: "underline wavy #F07178",
      textUnderlineOffset: "3px",
    },
    ".cm-diagnostic-warning": {
      textDecoration: "underline wavy #E8A87C",
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
  ];
}

export interface EditorProps {
  /** Fired when the user focuses into the editor (e.g. to cancel autoplay). */
  onUserFocus?: () => void;
}

export function Editor({ onUserFocus }: EditorProps) {
  const { source, setSource, result } = usePlayground();
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const setSourceRef = useRef(setSource);
  setSourceRef.current = setSource;
  const onUserFocusRef = useRef(onUserFocus);
  onUserFocusRef.current = onUserFocus;

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

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onFocusIn = () => {
      onUserFocusRef.current?.();
    };
    host.addEventListener("focusin", onFocusIn);
    return () => host.removeEventListener("focusin", onFocusIn);
  }, []);

  return (
    <div
      ref={hostRef}
      aria-label="Source editor"
      data-testid="source-editor"
      className="h-full w-full overflow-hidden bg-panel"
    />
  );
}
