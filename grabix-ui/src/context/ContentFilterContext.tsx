import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BACKEND_API } from "../lib/api";

interface ContentFilterContextValue {
  adultContentBlocked: boolean;
  adultPasswordConfigured: boolean;
  unlockAdultContent: (password: string) => Promise<void>;
  configureAdultContent: (password: string) => Promise<void>;
}

const ContentFilterContext = createContext<ContentFilterContextValue | null>(null);

export function ContentFilterProvider({ children }: { children: ReactNode }) {
  const [adultContentBlocked, setAdultContentBlocked] = useState(true);
  const [adultPasswordConfigured, setAdultPasswordConfigured] = useState(false);

  useEffect(() => {
    fetch(`${BACKEND_API}/settings`)
      .then((response) => response.json())
      .then((data: Record<string, unknown>) => {
        setAdultContentBlocked(data.adult_content_enabled !== true);
        setAdultPasswordConfigured(data.adult_password_configured === true);
      })
      .catch(() => {
        setAdultContentBlocked(true);
        setAdultPasswordConfigured(false);
      });
  }, []);

  const value = useMemo<ContentFilterContextValue>(() => ({
    adultContentBlocked,
    adultPasswordConfigured,
    configureAdultContent: async (password: string) => {
      const response = await fetch(`${BACKEND_API}/settings/adult-content/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Could not save the password.");
      }
      setAdultPasswordConfigured(true);
    },
    unlockAdultContent: async (password: string) => {
      const response = await fetch(`${BACKEND_API}/settings/adult-content/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(typeof payload.detail === "string" ? payload.detail : "Incorrect password");
      }
      setAdultContentBlocked(false);
    },
  }), [adultContentBlocked, adultPasswordConfigured]);

  return <ContentFilterContext.Provider value={value}>{children}</ContentFilterContext.Provider>;
}

export function useContentFilter() {
  const context = useContext(ContentFilterContext);
  if (!context) {
    throw new Error("useContentFilter must be used inside ContentFilterProvider");
  }
  return context;
}
