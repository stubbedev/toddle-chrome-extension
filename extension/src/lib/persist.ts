import { useEffect, useState } from "react";

/**
 * UI state that survives panel opens/navigation, stored in the extension
 * page's localStorage. Values are validated on load so a stale or corrupted
 * entry falls back to the initial value instead of poisoning the UI.
 */

const PREFIX = "toddle-companion:";

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  isValid?: (value: unknown) => value is T,
): [T, (value: T | ((current: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    const stored = read(key);
    if (stored === null) return initial;
    return isValid ? (isValid(stored) ? stored : initial) : (stored as T);
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(state));
    } catch {
      // storage unavailable (quota/private mode): session-only state
    }
  }, [key, state]);

  return [state, setState];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
