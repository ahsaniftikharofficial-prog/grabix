// hooks/useMiniPlayer.ts
// Mini-player state: when the user navigates away while something is playing,
// the mini player floats in the corner. Click it to return to the full player.
import { createContext, useContext, useState, useCallback, type ReactNode, createElement } from "react";

export interface MiniPlayerState {
  active: boolean;
  title: string;
  poster?: string;
  /** Opaque payload passed back to the page that launched the player */
  payload: Record<string, unknown>;
}

interface MiniPlayerCtx {
  mini: MiniPlayerState | null;
  activate: (state: MiniPlayerState) => void;
  dismiss: () => void;
  restore: () => MiniPlayerState | null;
}

const Ctx = createContext<MiniPlayerCtx | null>(null);

export function MiniPlayerProvider({ children }: { children: ReactNode }) {
  const [mini, setMini] = useState<MiniPlayerState | null>(null);

  const activate = useCallback((state: MiniPlayerState) => setMini(state), []);
  const dismiss = useCallback(() => setMini(null), []);
  const restore = useCallback(() => {
    const current = mini;
    setMini(null);
    return current;
  }, [mini]);

  return createElement(Ctx.Provider, { value: { mini, activate, dismiss, restore } }, children);
}

export function useMiniPlayer(): MiniPlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMiniPlayer must be inside MiniPlayerProvider");
  return ctx;
}
