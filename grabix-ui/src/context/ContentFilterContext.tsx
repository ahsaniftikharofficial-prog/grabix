import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const API = "http://127.0.0.1:8000";

interface ContentFilterContextValue {
  adultContentBlocked: boolean;
  unlockAdultContent: (password: string) => Promise<void>;
}

const ContentFilterContext = createContext<ContentFilterContextValue | null>(null);

export function ContentFilterProvider({ children }: { children: ReactNode }) {
  const [adultContentBlocked, setAdultContentBlocked] = useState(true);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((response) => response.json())
      .then((data: Record<string, unknown>) => {
        setAdultContentBlocked(data.adult_content_enabled !== true);
      })
      .catch(() => {
        setAdultContentBlocked(true);
      });
  }, []);

  const value = useMemo<ContentFilterContextValue>(() => ({
    adultContentBlocked,
    unlockAdultContent: async (password: string) => {
      const response = await fetch(`${API}/settings/adult-content/unlock`, {
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
  }), [adultContentBlocked]);

  return <ContentFilterContext.Provider value={value}>{children}</ContentFilterContext.Provider>;
}

export function useContentFilter() {
  const context = useContext(ContentFilterContext);
  if (!context) {
    throw new Error("useContentFilter must be used inside ContentFilterProvider");
  }
  return context;
}
