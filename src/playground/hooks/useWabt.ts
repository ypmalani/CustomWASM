import { useEffect, useState } from "react";
import wabtFactory from "wabt";

export type WabtModule = Awaited<ReturnType<typeof wabtFactory>>;

let cached: WabtModule | null = null;
let pending: Promise<WabtModule> | null = null;

function loadWabt(): Promise<WabtModule> {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = wabtFactory().then((mod) => {
      cached = mod;
      return mod;
    });
  }
  return pending;
}

export interface UseWabtResult {
  wabt: WabtModule | null;
  loading: boolean;
  error: string | null;
}

/** Async-init wabt once at app startup and cache the module. */
export function useWabt(): UseWabtResult {
  const [wabt, setWabt] = useState<WabtModule | null>(cached);
  const [loading, setLoading] = useState(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cached) {
      setWabt(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    loadWabt()
      .then((mod) => {
        if (!cancelled) {
          setWabt(mod);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { wabt, loading, error };
}
