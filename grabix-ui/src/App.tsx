import { useEffect, useState, type ReactNode } from "react";
import { ThemeProvider } from "./context/ThemeContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { ContentFilterProvider } from "./context/ContentFilterContext";
import Sidebar, { type Page } from "./components/Sidebar";
import ConverterPage from "./pages/ConverterPage";
import DownloaderPage from "./pages/DownloaderPage";
import LibraryPage from "./pages/LibraryPage";
import AnimePage from "./pages/AnimePage";
import MangaPage from "./pages/MangaPage";
import ExplorePage from "./pages/ExplorePage";
import MoviesPage from "./pages/MoviesPage";
import MovieBoxPage from "./pages/MovieBoxPage";
import TVSeriesPage from "./pages/TVSeriesPage";
import FavoritesPage from "./pages/FavoritesPage";
import SettingsPage from "./pages/SettingsPage";
import { BACKEND_API, checkBackendReady, waitForBackendReady } from "./lib/api";
import "./index.css";

function Inner() {
  const [page, setPage] = useState<Page>("downloader");
  const [backendOk, setBackendOk] = useState(false);
  const [backendStarting, setBackendStarting] = useState(true);
  const [activeDownloads, setActiveDownloads] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const syncBackend = async () => {
      const ready = await checkBackendReady();
      if (!cancelled) {
        setBackendOk(ready);
        if (ready) {
          setBackendStarting(false);
        }
      }
    };

    const syncDownloads = async () => {
      try {
        const response = await fetch(`${BACKEND_API}/downloads`);
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

    const bootstrapBackend = async () => {
      const ready = await waitForBackendReady();
      if (!cancelled) {
        setBackendOk(ready);
        setBackendStarting(false);
      }
    };

    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page }>).detail;
      if (detail?.page) {
        setPage(detail.page);
      }
    };

    void bootstrapBackend();
    void syncDownloads();
    const interval = window.setInterval(() => {
      void syncBackend();
      void syncDownloads();
    }, 1500);

    window.addEventListener("grabix:navigate", handleNavigate as EventListener);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("grabix:navigate", handleNavigate as EventListener);
    };
  }, []);

  const pages: Record<Page, ReactNode> = {
    downloader: <DownloaderPage />,
    converter: <ConverterPage />,
    library: <LibraryPage />,
    anime: <AnimePage />,
    manga: <MangaPage />,
    explore: <ExplorePage />,
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
        {backendStarting ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="player-loader" />
            <p>Starting GRABIX services...</p>
            <span>Preparing the bundled backend and providers.</span>
          </div>
        ) : !backendOk ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <p>GRABIX backend is offline.</p>
            <span>The installed app is waiting for its local services to start.</span>
            <button
              className="btn btn-primary"
              onClick={() => {
                setBackendStarting(true);
                void waitForBackendReady().then((ready) => {
                  setBackendOk(ready);
                  setBackendStarting(false);
                });
              }}
            >
              Retry
            </button>
          </div>
        ) : (
          pages[page]
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ContentFilterProvider>
        <FavoritesProvider>
          <Inner />
        </FavoritesProvider>
      </ContentFilterProvider>
    </ThemeProvider>
  );
}
