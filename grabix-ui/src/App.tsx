// grabix-ui/src/App.tsx
// Updated: FavoritesProvider + FavoritesPage added

import { useState, useEffect } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import Sidebar, { type Page } from "./components/Sidebar";
import DownloaderPage from "./pages/DownloaderPage";
import LibraryPage    from "./pages/LibraryPage";
import StoragePage    from "./pages/StoragePage";
import AnimePage      from "./pages/AnimePage";
import MangaPage      from "./pages/MangaPage";
import MoviesPage     from "./pages/MoviesPage";
import TVSeriesPage   from "./pages/TVSeriesPage";
import FavoritesPage  from "./pages/FavoritesPage";
import SettingsPage   from "./pages/SettingsPage";
import "./index.css";

function Inner() {
  const [page, setPage]           = useState<Page>("downloader");
  const [backendOk, setBackendOk] = useState(false);
  const [activeDownloads]         = useState(0);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/")
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
  }, []);

  const PAGES: Record<Page, React.ReactNode> = {
    downloader: <DownloaderPage />,
    library:    <LibraryPage />,
    storage:    <StoragePage />,
    anime:      <AnimePage />,
    manga:      <MangaPage />,
    movies:     <MoviesPage />,
    series:     <TVSeriesPage />,
    favorites:  <FavoritesPage />,
    settings:   <SettingsPage />,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar page={page} setPage={setPage} activeDownloads={activeDownloads} backendOk={backendOk} />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
        {PAGES[page]}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FavoritesProvider>
        <Inner />
      </FavoritesProvider>
    </ThemeProvider>
  );
}
