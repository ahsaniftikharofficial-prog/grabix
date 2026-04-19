import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { WatchdogBanner } from "./components/WatchdogBanner";
import { useOfflineDetection } from "./lib/useOfflineDetection";
import { useWatchdog } from "./lib/useWatchdog";
import { ThemeProvider } from "./context/ThemeContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { ContentFilterProvider } from "./context/ContentFilterContext";
import { RuntimeHealthProvider } from "./context/RuntimeHealthContext";
import Sidebar, { type Page } from "./components/Sidebar";
import {
  BACKEND_API,
  backendJson,
  deriveRuntimeState,
  fetchBackendPing,
  fetchRuntimeHealth,
  fetchStartupDiagnostics,
  type RuntimeHealthPayload,
  type RuntimeState,
  type StartupDiagnosticsPayload,
  waitForBackendCoreReady,
} from "./lib/api";
import { fetchConsumetHealth } from "./lib/consumetProviders";
import { fetchTrendingManga } from "./lib/mangaProviders";
import { markPerf, measurePerf } from "./lib/performance";
import { fetchMovieBoxDiscover } from "./lib/streamProviders";
import "./index.css";

const DownloaderPage = lazy(() => import("./pages/DownloaderPage"));
const ConverterPage = lazy(() => import("./pages/ConverterPage"));
const LibraryPage = lazy(() => import("./pages/LibraryPage"));
const AnimePage = lazy(() => import("./pages/AnimePage"));
const AnimePageV2 = lazy(() => import("./pages/AnimePageV2"));

const MangaPage = lazy(() => import("./pages/MangaPage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const MoviesPage = lazy(() => import("./pages/MoviesPage"));
const MovieBoxPage = lazy(() => import("./pages/MovieBoxPage"));
const TVSeriesPage = lazy(() => import("./pages/TVSeriesPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const RatingsPage  = lazy(() => import("./pages/RatingsPage"));

function Inner() {
  const offlineState = useOfflineDetection(BACKEND_API);
  const watchdog = useWatchdog();
  const [page, setPage] = useState<Page>("downloader");
  const [_pageRevision, setPageRevision] = useState(0);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("starting");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [backendCoreReady, setBackendCoreReady] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState(0);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthPayload | null>(null);
  const [startupDiagnostics, setStartupDiagnostics] = useState<StartupDiagnosticsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    markPerf("app-shell-bootstrap");
    markPerf("backend-ready");

    const applyRuntimeSnapshot = (
      health: RuntimeHealthPayload | null,
      nextBootstrapping: boolean
    ) => {
      if (cancelled) return;
      setRuntimeHealth(health);
      setBootstrapping(nextBootstrapping);
    };

    const syncRuntimeHealth = async () => {
      try {
        const ping = await fetchBackendPing();
        if (!cancelled) {
          setBackendCoreReady(Boolean(ping.core_ready));
        }
        const payload = await fetchRuntimeHealth();
        if (!cancelled) {
          applyRuntimeSnapshot(payload, false);
        }
      } catch {
        if (!cancelled) {
          applyRuntimeSnapshot(null, false);
        }
      }
    };

    const bootstrapBackend = async () => {
      const coreReady = await waitForBackendCoreReady(75000, 500);
      if (cancelled) return;

      setBackendCoreReady(coreReady);
      setBootstrapping(false);
      const diagnostics = await fetchStartupDiagnostics();
      if (!cancelled) {
        setStartupDiagnostics(diagnostics);
      }

      if (!coreReady) {
        applyRuntimeSnapshot(null, false);
        return;
      }

      measurePerf("app-shell-bootstrap");
      measurePerf("backend-ready");

      try {
        const payload = await fetchRuntimeHealth();
        if (!cancelled) {
          applyRuntimeSnapshot(payload, false);
        }
      } catch {
        if (!cancelled) {
          applyRuntimeSnapshot(null, false);
        }
      }
    };

    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: Page }>).detail;
      const nextPage = detail?.page;
      if (nextPage) {
        setPage((current) => {
          if (current === nextPage) {
            setPageRevision((value) => value + 1);
          }
          return nextPage;
        });
      }
    };

    void bootstrapBackend();
    void fetchStartupDiagnostics().then((payload) => {
      if (!cancelled) {
        setStartupDiagnostics(payload);
      }
    });
    const interval = window.setInterval(() => {
      void syncRuntimeHealth();
      void fetchStartupDiagnostics().then((payload) => {
        if (!cancelled && payload) setStartupDiagnostics(payload);
      });
    }, 2500);

    window.addEventListener("grabix:navigate", handleNavigate as EventListener);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("grabix:navigate", handleNavigate as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!backendCoreReady) {
      setActiveDownloads(0);
      return;
    }
    if (page !== "downloader" && activeDownloads <= 0) {
      return;
    }

    let cancelled = false;

    const syncDownloads = async () => {
      try {
        const downloads = await backendJson<Array<{ status?: string }>>("/downloads");
        if (cancelled) return;
        setActiveDownloads(
          downloads.filter((item) =>
            ["queued", "downloading", "processing", "paused"].includes(item.status ?? "")
          ).length
        );
      } catch {
        if (!cancelled) {
          setActiveDownloads(0);
        }
      }
    };

    void syncDownloads();
    const interval = window.setInterval(() => {
      void syncDownloads();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backendCoreReady, page, activeDownloads]);

  useEffect(() => {
    setRuntimeState(
      deriveRuntimeState({
        health: runtimeHealth,
        startupDiagnostics,
        bootstrapping,
        backendCoreReady,
      })
    );
  }, [runtimeHealth, startupDiagnostics, bootstrapping, backendCoreReady]);

  useEffect(() => {
    const backendOk = Boolean(runtimeHealth?.summary.backend_reachable);
    if (!backendOk) return;

    const timeoutId = window.setTimeout(() => {
      void Promise.allSettled([
        fetch(`${BACKEND_API}/providers/status`).catch(() => null),
        fetchMovieBoxDiscover().catch(() => null),
        fetchConsumetHealth().catch(() => null),
        fetchTrendingManga(1).catch(() => null),
      ]);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [runtimeHealth]);

  const pages: Record<Page, ReactNode> = {
    downloader: <ErrorBoundary section="Downloader"><DownloaderPage onDownloadStarting={watchdog.notifyDownloadStarting} /></ErrorBoundary>,
    converter:  <ErrorBoundary section="Converter"><ConverterPage /></ErrorBoundary>,
    library:    <ErrorBoundary section="Library"><LibraryPage /></ErrorBoundary>,
    anime:      <ErrorBoundary section="Anime"><AnimePage /></ErrorBoundary>,
    animev2:    <ErrorBoundary section="Anime V2"><AnimePageV2 /></ErrorBoundary>,

    manga:      <ErrorBoundary section="Manga"><MangaPage /></ErrorBoundary>,
    explore:    <ErrorBoundary section="Explore"><ExplorePage /></ErrorBoundary>,
    movies:     <ErrorBoundary section="Movies"><MoviesPage /></ErrorBoundary>,
    moviebox:   <ErrorBoundary section="MovieBox"><MovieBoxPage /></ErrorBoundary>,
    series:     <ErrorBoundary section="TV Series"><TVSeriesPage /></ErrorBoundary>,
    favorites:  <ErrorBoundary section="Favorites"><FavoritesPage /></ErrorBoundary>,
    ratings:    <ErrorBoundary section="Ratings"><RatingsPage /></ErrorBoundary>,
    settings:   <ErrorBoundary section="Settings"><SettingsPage /></ErrorBoundary>,
  };

  const refreshRuntimeHealth = async () => {
    try {
      const payload = await fetchRuntimeHealth();
      setRuntimeHealth(payload);
      setBootstrapping(false);
    } catch {
      setRuntimeHealth(null);
      setBootstrapping(false);
    }
  };

  const navigateToPage = (nextPage: Page, options?: { refresh?: boolean }) => {
    setPage((current) => {
      if (current === nextPage || options?.refresh) {
        setPageRevision((value) => value + 1);
      }
      return nextPage;
    });
  };
  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <OfflineBanner offlineState={bootstrapping ? { isOffline: false, reason: null, since: null } : offlineState} />
      <WatchdogBanner status={watchdog.status} isBannerVisible={watchdog.isBannerVisible} />
      <Sidebar page={page} setPage={navigateToPage} activeDownloads={activeDownloads} runtimeState={runtimeState} runtimeHealth={runtimeHealth} />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-app)",
          paddingTop: watchdog.isBannerVisible && watchdog.status !== "idle" ? 32 : 0,
          transition: "padding-top 0.2s ease",
        }}
      >
        <RuntimeHealthProvider value={{ health: runtimeHealth, runtimeState, refreshHealth: refreshRuntimeHealth }}>
          <Suspense fallback={<PageLoadingState page={page} />}>
            {(Object.keys(pages) as Page[]).map((p) => (
              <div
                key={p}
                style={{
                  display: page === p ? "flex" : "none",
                  flexDirection: "column",
                  flex: 1,
                  width: "100%",
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {pages[p]}
              </div>
            ))}
          </Suspense>
        </RuntimeHealthProvider>
      </main>
    </div>
  );
}

function PageLoadingState({ page }: { page: Page }) {
  return (
    <div className="empty-state" style={{ height: "100%" }}>
      <div className="player-loader" />
      <p>Loading {page}...</p>
      <span>Preparing this part of GRABIX on demand for a faster startup.</span>
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
