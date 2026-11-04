import { useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** UI preferences only. Storage failure must never prevent using the app. */
export function useStoredPreference<T>(
  key: string | null,
  fallback: T,
  validate: (value: unknown) => T,
  storage: "localStorage" | "sessionStorage" = "localStorage",
) {
  const [snapshot, setSnapshot] = useState<{ key: string | null; value: T }>({
    key: null,
    value: fallback,
  });
  const defaults = useRef(fallback);
  const validator = useRef(validate);
  useEffect(() => {
    let value = defaults.current;
    if (key) {
      try {
        const saved = window[storage].getItem(key);
        if (saved) value = validator.current(JSON.parse(saved));
      } catch {
        /* Use defaults. */
      }
    }
    setSnapshot({ key, value });
  }, [key, storage]);
  useEffect(() => {
    if (!key || snapshot.key !== key) return;
    try {
      window[storage].setItem(key, JSON.stringify(snapshot.value));
    } catch {
      /* Private browsing and quota errors are harmless. */
    }
  }, [key, snapshot, storage]);
  const value = snapshot.key === key ? snapshot.value : fallback;
  const update = (next: T | ((value: T) => T)) =>
    setSnapshot((current) => ({
      key,
      value:
        typeof next === "function"
          ? (next as (value: T) => T)(current.key === key ? current.value : defaults.current)
          : next,
    }));
  return [value, update] as const;
}

export function useAsyncAction() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const run = async (
    task: () => Promise<void>,
    message = "Could not save this change. Please try again.",
  ) => {
    if (busy.current) return false;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await task();
      return true;
    } catch {
      setError(message);
      return false;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { run, pending, error, clearError: () => setError("") };
}
