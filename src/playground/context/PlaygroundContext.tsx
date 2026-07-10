import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { compile, type CompileResult } from "../../compiler/pipeline.js";
import { useDebouncedValue } from "../hooks/useDebouncedValue.js";
import { useWabt, type WabtModule } from "../hooks/useWabt.js";
import { readInitialSource } from "../lib/introSource.js";
import { runWasm } from "../lib/runWasm.js";

export interface PlaygroundContextValue {
  source: string;
  setSource: (source: string) => void;
  result: CompileResult;
  runOutput: string[];
  run: () => Promise<void>;
  wabt: WabtModule | null;
  wabtLoading: boolean;
  wabtError: string | null;
  running: boolean;
}

const PlaygroundContext = createContext<PlaygroundContextValue | null>(null);

export function PlaygroundProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState(readInitialSource);
  const debouncedSource = useDebouncedValue(source, 300);
  const result = useMemo(
    () => compile(debouncedSource),
    [debouncedSource],
  );

  const { wabt, loading: wabtLoading, error: wabtError } = useWabt();
  const [runOutput, setRunOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (!wabt || result.wat === null) return;
    setRunning(true);
    setRunOutput([]);
    try {
      const outcome = await runWasm(wabt, result.wat);
      if (outcome.ok) {
        setRunOutput([...outcome.prints, `main() => ${outcome.value}`]);
      } else {
        setRunOutput([`error: ${outcome.error}`]);
      }
    } finally {
      setRunning(false);
    }
  }, [wabt, result.wat]);

  const value = useMemo<PlaygroundContextValue>(
    () => ({
      source,
      setSource,
      result,
      runOutput,
      run,
      wabt,
      wabtLoading,
      wabtError,
      running,
    }),
    [
      source,
      result,
      runOutput,
      run,
      wabt,
      wabtLoading,
      wabtError,
      running,
    ],
  );

  return (
    <PlaygroundContext.Provider value={value}>
      {children}
    </PlaygroundContext.Provider>
  );
}

export function usePlayground(): PlaygroundContextValue {
  const ctx = useContext(PlaygroundContext);
  if (!ctx) {
    throw new Error("usePlayground must be used within PlaygroundProvider");
  }
  return ctx;
}
