import { createContext, useContext, type ReactNode } from "react";
import type { RuntimeHealthPayload, RuntimeState } from "../lib/api";

interface RuntimeHealthContextValue {
  health: RuntimeHealthPayload | null;
  runtimeState: RuntimeState;
  refreshHealth: () => Promise<void>;
}

const RuntimeHealthContext = createContext<RuntimeHealthContextValue>({
  health: null,
  runtimeState: "starting",
  refreshHealth: async () => {},
});

export function RuntimeHealthProvider({
  value,
  children,
}: {
  value: RuntimeHealthContextValue;
  children: ReactNode;
}) {
  return <RuntimeHealthContext.Provider value={value}>{children}</RuntimeHealthContext.Provider>;
}

export function useRuntimeHealth() {
  return useContext(RuntimeHealthContext);
}
