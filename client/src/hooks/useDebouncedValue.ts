import { useEffect, useState } from "react";

/**
 * Debounced value — 300ms is the closed interval for public search
 * (C7, applied identically on PB-01 and PB-03).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
