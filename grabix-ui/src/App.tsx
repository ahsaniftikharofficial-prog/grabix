import React, { useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import HomePage from "./pages/HomePage";
import DownloaderPage from "./pages/DownloaderPage";
import QueuePage from "./pages/QueuePage";
import LibraryPage from "./pages/LibraryPage";
import AnimePage from "./pages/AnimePage";
import MoviesPage from "./pages/MoviesPage";
import SettingsPage from "./pages/SettingsPage";

type Page = "home"|"downloader"|"queue"|"library"|"anime"|"movies"|"settings";

export default function App() {
  const [page, setPage]   = useState<Page>("home");
  const [theme, setTheme] = useState<string>("dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => t === "dark" ? "light" : "dark");
  const props = { theme, onToggleTheme: toggleTheme, onNav: setPage };

  const renderPage = () => {
    switch (page) {
      case "home":       return <HomePage {...props} />;
      case "downloader": return <DownloaderPage theme={theme} onToggleTheme={toggleTheme} />;
      case "queue":      return <QueuePage theme={theme} onToggleTheme={toggleTheme} />;
      case "library":    return <LibraryPage theme={theme} onToggleTheme={toggleTheme} />;
      case "anime":      return <AnimePage theme={theme} onToggleTheme={toggleTheme} />;
      case "movies":     return <MoviesPage {...props} />;
      case "settings":   return <SettingsPage theme={theme} onToggleTheme={toggleTheme} />;
      default:           return <HomePage {...props} />;
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      <Sidebar active={page} onNav={setPage} />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {renderPage()}
      </main>
    </div>
  );
}
