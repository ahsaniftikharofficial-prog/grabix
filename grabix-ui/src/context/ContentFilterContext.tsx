import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BACKEND_API, backendFetch, backendJson } from "../lib/api";

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
    backendJson<Record<string, unknown>>(`${BACKEND_API}/settings`)
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
      const response = await backendFetch(`${BACKEND_API}/settings/adult-content/configure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }, { sensitive: true });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload.message === "string" ? payload.message :
          typeof payload.detail === "string" ? payload.detail :
          typeof payload.detail?.message === "string" ? payload.detail.message :
          "Could not save the password.";
        throw new Error(message);
      }
      setAdultPasswordConfigured(true);
    },
    unlockAdultContent: async (password: string) => {
      const response = await backendFetch(`${BACKEND_API}/settings/adult-content/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }, { sensitive: true });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message =
          typeof payload.message === "string" ? payload.message :
          typeof payload.detail === "string" ? payload.detail :
          typeof payload.detail?.message === "string" ? payload.detail.message :
          "Incorrect password";
        throw new Error(message);
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
