import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { readStringStorage, versionedStorageKey, writeStringStorage } from "../lib/persistentState";

type Theme = "light" | "dark";
interface ThemeContextType { theme: Theme; toggle: () => void; }

const ThemeContext = createContext<ThemeContextType>({ theme: "light", toggle: () => {} });
const THEME_STORAGE_KEY = versionedStorageKey("grabix-theme", "v2");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readStringStorage("local", THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    writeStringStorage("local", THEME_STORAGE_KEY, theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme(t => t === "light" ? "dark" : "light") }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
