import { useCallback, useEffect, useState } from "react";
import { MSG, send } from "../shared/messages";
import type { AppStateSnapshot } from "../shared/types";

/** Live snapshot of background state: initial GET_STATE, STATE_UPDATED pushes, slow re-poll as a safety net. */
export function useAppState(): { state: AppStateSnapshot | null; error: string | null; refresh: () => void } {
  const [state, setState] = useState<AppStateSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    send({ type: MSG.GET_STATE })
      .then((s) => {
        setState(s);
        setError(null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    refresh();
    const listener = (message: unknown) => {
      const m = message as { type?: string; state?: AppStateSnapshot };
      if (m?.type === MSG.STATE_UPDATED && m.state) setState(m.state);
    };
    chrome.runtime.onMessage.addListener(listener);
    const poll = setInterval(refresh, 15_000);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(poll);
    };
  }, [refresh]);

  return { state, error, refresh };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
