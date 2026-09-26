"use client";

import { useEffect, useState } from "react";

/**
 * Resolve one of the memoized snapshot loaders (lib/ui/snapshotAux.ts) into React state.
 * `enabled` false keeps it idle (for example until the simulator itself has loaded, so the UI files never
 * compete with the snapshot download).
 */
export function useSnapshotFile<T>(load: () => Promise<T>, enabled = true): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then(
      (data) => live && setState({ data, error: null }),
      (e) => live && setState({ data: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [load, enabled]);
  return state;
}
