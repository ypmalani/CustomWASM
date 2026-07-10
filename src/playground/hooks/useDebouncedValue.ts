import { useEffect, useState } from "react";

/**
 * Returns `value` delayed by `delayMs` (default 300ms).
 * Used so compilation re-runs on a debounce rather than every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
