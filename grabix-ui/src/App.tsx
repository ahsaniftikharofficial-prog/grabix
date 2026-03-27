import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import Sidebar, { type Page } from "./components/Sidebar";
import ConverterPage from "./pages/ConverterPage";
import DownloaderPage from "./pages/DownloaderPage";
import LibraryPage from "./pages/LibraryPage";
import StoragePage from "./pages/StoragePage";
import AnimePage from "./pages/AnimePage";
import MangaPage from "./pages/MangaPage";
import MoviesPage from "./pages/MoviesPage";
import MovieBoxPage from "./pages/MovieBoxPage";
import TVSeriesPage from "./pages/TVSeriesPage";
import FavoritesPage from "./pages/FavoritesPage";
import SettingsPage from "./pages/SettingsPage";
import "./index.css";

function Inner() {
  const [page, setPage] = useState<Page>("downloader");
  const [backendOk, setBackendOk] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState(0);

  useEffect(() => {
    const syncBackend = async () => {
      try {
        await fetch("http://127.0.0.1:8000/");
        setBackendOk(true);
      } catch {
        setBackendOk(false);
      }
    };

    const syncDownloads = async () => {
      try {
        const response = await fetch("http://127.0.0.1:8000/downloads");
        if (!response.ok) return;
        const downloads = (await response.json()) as Array<{ status?: string }>;
        setActiveDownloads(
          downloads.filter((item) =>
            ["queued", "downloading", "processing", "paused"].includes(item.status ?? "")
          ).length
        );
      } catch {
        setActiveDownloads(0);
      }
    };

    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page }>).detail;
      if (detail?.page) {
        setPage(detail.page);
      }
    };

    void syncBackend();
    void syncDownloads();
    const interval = window.setInterval(() => {
      void syncBackend();
      void syncDownloads();
    }, 1500);

    window.addEventListener("grabix:navigate", handleNavigate as EventListener);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("grabix:navigate", handleNavigate as EventListener);
    };
  }, []);

  const pages: Record<Page, ReactNode> = {
    downloader: <DownloaderPage />,
    converter: <ConverterPage />,
    library: <LibraryPage />,
    storage: <StoragePage />,
    anime: <AnimePage />,
    manga: <MangaPage />,
    movies: <MoviesPage />,
    moviebox: <MovieBoxPage />,
    series: <TVSeriesPage />,
    favorites: <FavoritesPage />,
    settings: <SettingsPage />,
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <Sidebar page={page} setPage={setPage} activeDownloads={activeDownloads} backendOk={backendOk} />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--bg-app)" }}>
        {pages[page]}
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
