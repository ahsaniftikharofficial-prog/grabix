import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { HashLoader } from "react-spinners";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { WatchdogBanner } from "./components/WatchdogBanner";
import { IconAlert, IconRefresh, IconServers, IconWifi } from "./components/Icons";
import { useOfflineDetection } from "./lib/useOfflineDetection";
import { useWatchdog } from "./lib/useWatchdog";
import { ThemeProvider } from "./context/ThemeContext";
import { FavoritesProvider } from "./context/FavoritesContext";
import { ContentFilterProvider } from "./context/ContentFilterContext";
import { RuntimeHealthProvider } from "./context/RuntimeHealthContext";
import Sidebar, { type Page } from "./components/Sidebar";
import {
  BACKEND_API,
  deriveRuntimeState,
  fetchBackendPing,
  invalidateRuntimeRecoveryCaches,
  openStartupLog,
  fetchRuntimeHealth,
  fetchStartupDiagnostics,
  resetServiceCircuitBreaker,
  restartConsumetSidecar,
  restartGrabix,
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
const MangaPage = lazy(() => import("./pages/MangaPage"));
const ExplorePage = lazy(() => import("./pages/ExplorePage"));
const MoviesPage = lazy(() => import("./pages/MoviesPage"));
const MovieBoxPage = lazy(() => import("./pages/MovieBoxPage"));
const TVSeriesPage = lazy(() => import("./pages/TVSeriesPage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const RatingsPage  = lazy(() => import("./pages/RatingsPage"));
const AUTO_SERVICE_RESET_INTERVAL_MS = 2200;
const AUTO_SERVICE_RESTART_INTERVAL_MS = 6500;
const AUTO_CONSUMET_RESTART_GRACE_MS = 5000;
const MANUAL_SERVICE_ACTION_ATTEMPTS = 5;
const MANUAL_RESTART_ESCALATION_ATTEMPTS = 6;
const MAX_AUTO_RECOVERY_ATTEMPTS = 6;
const NETWORK_REQUIRED_PAGES = new Set<Page>(["anime", "manga", "explore", "movies", "moviebox", "series", "ratings"]);

type RecoveryAction = {
  id: string;
  label: string;
  variant?: "primary" | "secondary";
  onClick: () => void;
  loading?: boolean;
};

type RecoveryTone = "info" | "warning" | "danger";

interface PageServiceIssue {
  serviceKey: "consumet" | "moviebox" | "manga" | "ffmpeg";
  status: "degraded" | "offline";
  retryable: boolean;
  title: string;
  message: string;
  restartLabel?: string;
}

interface AutoRecoveryState {
  serviceKey: PageServiceIssue["serviceKey"];
  label: string;
  attempt: number;
  phase: "retrying" | "restarting";
  message: string;
}

function getRecoveryBackoffMs(baseMs: number, attempt: number, maxMs: number): number {
  const exponent = Math.max(0, Math.min(attempt, 4));
  return Math.min(baseMs * (2 ** exponent), maxMs);
}

function isOnlyConsumetDegraded(health: RuntimeHealthPayload | null): boolean {
  const degraded = health?.summary.degraded_services ?? [];
  return degraded.length === 1 && degraded[0] === "consumet";
}

function getPageServiceIssue(
  page: Page,
  health: RuntimeHealthPayload | null
): PageServiceIssue | null {
  const services = health?.services;
  if (!services) return null;

  switch (page) {
    case "anime": {
      const animeService = services.anime;
      const consumetService = services.consumet;
      if (!animeService || !["degraded", "offline"].includes(animeService.status)) return null;
      return {
        serviceKey: "consumet",
        status: animeService.status === "offline" ? "offline" : "degraded",
        retryable: consumetService?.retryable ?? animeService.retryable,
        title: "Getting Anime Ready",
        message: "Please wait a moment while Anime gets ready.",
      };
    }
    case "moviebox": {
      const service = services.moviebox;
      if (!service || !["degraded", "offline"].includes(service.status)) return null;
      return {
        serviceKey: "moviebox",
        status: service.status === "offline" ? "offline" : "degraded",
        retryable: service.retryable,
        title: "Getting Movie Box Ready",
        message: "Please wait a moment while Movie Box gets ready.",
      };
    }
    case "manga": {
      const service = services.manga;
      if (!service || !["degraded", "offline"].includes(service.status)) return null;
      return {
        serviceKey: "manga",
        status: service.status === "offline" ? "offline" : "degraded",
        retryable: service.retryable,
        title: "Getting Manga Ready",
        message: "Please wait a moment while Manga gets ready.",
      };
    }
    case "converter": {
      const service = services.ffmpeg;
      if (!service || !["degraded", "offline"].includes(service.status)) return null;
      return {
        serviceKey: "ffmpeg",
        status: service.status === "offline" ? "offline" : "degraded",
        retryable: service.retryable,
        title: "Getting Converter Ready",
        message: "Please wait a moment while the converter gets ready.",
      };
    }
    default:
      return null;
  }
}

function getServiceLabel(serviceKey: PageServiceIssue["serviceKey"]): string {
  switch (serviceKey) {
    case "consumet":
      return "Anime";
    case "moviebox":
      return "Movie Box";
    case "manga":
      return "Manga";
    case "ffmpeg":
      return "Converter";
    default:
      return "GRABIX";
  }
}

function getAutoRecoveryCandidate(
  page: Page,
  health: RuntimeHealthPayload | null
): PageServiceIssue | null {
  const pageIssue = getPageServiceIssue(page, health);
  if (pageIssue?.retryable) {
    return pageIssue;
  }

  const services = health?.services;
  if (!services) return null;

  const priority: Array<PageServiceIssue["serviceKey"]> = ["consumet", "moviebox", "manga", "ffmpeg"];
  for (const serviceKey of priority) {
    const service = services[serviceKey];
    if (!service || !service.retryable || !["degraded", "offline"].includes(service.status)) {
      continue;
    }
    if (serviceKey === "consumet" && services.anime?.status === "online") {
      continue;
    }

    return {
      serviceKey,
      status: service.status === "offline" ? "offline" : "degraded",
      retryable: service.retryable,
      title: `Getting ${getServiceLabel(serviceKey)} Ready`,
      message: `Please wait a moment while ${getServiceLabel(serviceKey)} gets ready.`,
      restartLabel: serviceKey === "consumet" ? "Restart Anime Engine" : undefined,
    };
  }

  return null;
}

function shouldAutoRestartConsumet(
  diagnostics: StartupDiagnosticsPayload | null,
  issue: PageServiceIssue,
  startupAgeMs: number
): boolean {
  if (issue.serviceKey !== "consumet") return false;

  const status = diagnostics?.consumet.status ?? "";
  const failureCode = diagnostics?.consumet.failure_code ?? "";

  if (status === "missing" || failureCode === "consumet_runtime_missing" || failureCode === "consumet_resource_missing") {
    return false;
  }
  if (status === "starting") {
    return startupAgeMs >= AUTO_CONSUMET_RESTART_GRACE_MS;
  }

  return issue.status === "offline" || ["failed", "timeout", "port_in_use", "port_in_use"].includes(status);
}

function getPageSkeletonProfile(page: Page): {
  mode: "grid" | "rails" | "panels";
  cards: number;
  chips: number;
  title: string;
  subtitle: string;
} {
  switch (page) {
    case "anime":
      return { mode: "grid", cards: 12, chips: 5, title: "Anime", subtitle: "Loading anime for you." };
    case "movies":
      return { mode: "grid", cards: 12, chips: 5, title: "Movies", subtitle: "Loading movies for you." };
    case "series":
      return { mode: "grid", cards: 12, chips: 5, title: "TV Series", subtitle: "Loading shows for you." };
    case "moviebox":
      return { mode: "rails", cards: 12, chips: 4, title: "Movie Box", subtitle: "Loading titles for you." };
    case "manga":
      return { mode: "rails", cards: 10, chips: 3, title: "Manga", subtitle: "Loading manga for you." };
    case "explore":
    case "favorites":
    case "ratings":
      return { mode: "grid", cards: 10, chips: 4, title: "Browse", subtitle: "Loading this page for you." };
    case "downloader":
      return { mode: "panels", cards: 4, chips: 2, title: "Downloader", subtitle: "Loading your downloads." };
    case "converter":
      return { mode: "panels", cards: 3, chips: 2, title: "Converter", subtitle: "Loading your converter." };
    case "library":
      return { mode: "panels", cards: 5, chips: 3, title: "Library", subtitle: "Loading your library." };
    case "settings":
      return { mode: "panels", cards: 4, chips: 2, title: "Settings", subtitle: "Loading your settings." };
    default:
      return { mode: "grid", cards: 10, chips: 4, title: "GRABIX", subtitle: "Loading this page for you." };
  }
}

function BootStage({
  title,
  subtitle,
  detail,
  progress,
  caption,
}: {
  title: string;
  subtitle: string;
  detail?: string;
  progress: number;
  caption: string;
}) {
  const clampedProgress = Math.max(6, Math.min(progress, 100));
  const progressLabel = Math.round(clampedProgress);

  return (
    <div className="boot-stage">
      <div className="boot-stage__panel">
        <div className="startup-stage__badge">GRABIX</div>
        <div
          className="boot-stage__ring"
          style={{ "--boot-progress": `${clampedProgress * 3.6}deg` } as CSSProperties}
        >
          <div className="boot-stage__ring-core">
            <strong>{progressLabel}</strong>
            <span>%</span>
          </div>
          <div className="boot-stage__ring-orbit" />
        </div>
        <div className="boot-stage__copy">
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {detail ? <span>{detail}</span> : null}
        </div>
        <div className="boot-stage__meter">
          <div className="boot-stage__meter-fill" style={{ width: `${clampedProgress}%` }} />
        </div>
        <div className="boot-stage__caption">{caption}</div>
      </div>
    </div>
  );
}

function getReconnectLabel(issue: PageServiceIssue | null): string {
  if (!issue) return "Reconnect Service";
  switch (issue.serviceKey) {
    case "consumet":
      return "Reconnect Anime";
    case "moviebox":
      return "Reconnect Movie Box";
    case "manga":
      return "Reconnect Manga";
    case "ffmpeg":
      return "Reconnect Converter";
    default:
      return "Reconnect Service";
  }
}

function RecoveryStage({
  title,
  subtitle,
  detail,
  icon,
  tone = "info",
  actions = [],
}: {
  title: string;
  subtitle: string;
  detail?: string;
  icon: ReactNode;
  tone?: RecoveryTone;
  actions?: RecoveryAction[];
}) {
  const accent =
    tone === "danger" ? "var(--danger)" : tone === "warning" ? "var(--warning)" : "var(--accent)";

  return (
    <div className="startup-stage">
      <div className="startup-stage__panel">
        <div className="startup-stage__badge">GRABIX</div>
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: 22,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "color-mix(in srgb, var(--bg-surface2) 78%, transparent)",
            border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
            color: accent,
          }}
        >
          {icon}
        </div>
        <HashLoader color={accent} size={54} speedMultiplier={0.9} />
        <h2>{title}</h2>
        <p>{subtitle}</p>
        {detail ? <span>{detail}</span> : null}
        {actions.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 10,
              marginTop: 4,
            }}
          >
            {actions.map((action) => (
              <button
                key={action.id}
                className={`btn ${action.variant === "secondary" ? "btn-ghost" : "btn-primary"}`}
                onClick={action.onClick}
                disabled={action.loading}
                style={{ minWidth: 156, justifyContent: "center" }}
              >
                {action.loading ? "Working..." : action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ServiceRecoveryCard({
  title,
  message,
  actions,
  feedback,
  error,
  autoRecovery,
}: {
  title: string;
  message: string;
  actions: RecoveryAction[];
  feedback?: string;
  error?: string;
  autoRecovery?: AutoRecoveryState | null;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "min(360px, calc(100vw - 40px))",
        maxWidth: "100%",
        padding: 18,
        borderRadius: 20,
        background: "color-mix(in srgb, var(--bg-surface) 94%, transparent)",
        border: "1px solid color-mix(in srgb, var(--border) 84%, transparent)",
        boxShadow: "var(--shadow-lg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      {autoRecovery ? (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
            padding: "7px 10px",
            borderRadius: 999,
            background: "color-mix(in srgb, var(--accent-subtle) 80%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)",
            color: "var(--text-accent)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <IconRefresh size={13} className="spin-slow" />
          {autoRecovery.message}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 14,
            background: "var(--accent-subtle)",
            border: "1px solid color-mix(in srgb, var(--accent) 24%, transparent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-accent)",
          }}
        >
          <IconServers size={20} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{message}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {actions.map((action) => (
          <button
            key={action.id}
            className={`btn ${action.variant === "secondary" ? "btn-ghost" : "btn-primary"}`}
            onClick={action.onClick}
            disabled={action.loading}
            style={{ minWidth: 132, justifyContent: "center" }}
          >
            {action.loading ? "Working..." : action.label}
          </button>
        ))}
      </div>
      {feedback ? (
        <div style={{ fontSize: 12, color: "var(--text-success)", marginTop: 10 }}>{feedback}</div>
      ) : null}
      {error ? (
        <div style={{ fontSize: 12, color: "var(--text-danger)", marginTop: 10 }}>{error}</div>
      ) : null}
    </div>
  );
}

function ContentSkeletonStage({
  page,
  title,
  subtitle,
  detail,
  overlay,
}: {
  page: Page;
  title?: string;
  subtitle?: string;
  detail?: string;
  overlay?: ReactNode;
}) {
  const profile = getPageSkeletonProfile(page);

  return (
    <div className="content-skeleton">
      <div className="content-skeleton__header">
        <div>
          <div className="content-skeleton__eyebrow">{title || profile.title}</div>
          <h2>{title || profile.title}</h2>
          <p>{subtitle || profile.subtitle}</p>
          {detail ? <span>{detail}</span> : null}
        </div>
        <div className="content-skeleton__status">
          <IconRefresh size={16} className="spin-slow" />
          Please wait
        </div>
      </div>

      <div className="content-skeleton__toolbar">
        <div className="content-skeleton__line content-skeleton__line--lg" />
        <div className="content-skeleton__line content-skeleton__line--md" />
        <div className="content-skeleton__controls">
          {Array.from({ length: profile.chips }).map((_, index) => (
            <div
              key={`chip-${index}`}
              className="content-skeleton__chip shimmer"
              style={{ width: `${88 - (index % 3) * 12}px` }}
            />
          ))}
        </div>
      </div>

      {profile.mode === "grid" ? (
        <div className="content-skeleton__grid">
          {Array.from({ length: profile.cards }).map((_, index) => (
            <div key={`card-${index}`} className="content-skeleton__card">
              <div className="content-skeleton__poster shimmer" />
              <div className="content-skeleton__text shimmer" style={{ width: "84%" }} />
              <div className="content-skeleton__text shimmer" style={{ width: "52%" }} />
            </div>
          ))}
        </div>
      ) : profile.mode === "rails" ? (
        <div className="content-skeleton__rails">
          {Array.from({ length: 2 }).map((_, railIndex) => (
            <section key={`rail-${railIndex}`} className="content-skeleton__rail">
              <div className="content-skeleton__line content-skeleton__line--md" />
              <div className="content-skeleton__line content-skeleton__line--sm" />
              <div className="content-skeleton__grid content-skeleton__grid--rail">
                {Array.from({ length: profile.cards / 2 }).map((__, cardIndex) => (
                  <div key={`rail-card-${railIndex}-${cardIndex}`} className="content-skeleton__card">
                    <div className="content-skeleton__poster shimmer" />
                    <div className="content-skeleton__text shimmer" style={{ width: "84%" }} />
                    <div className="content-skeleton__text shimmer" style={{ width: "52%" }} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="content-skeleton__panels">
          {Array.from({ length: profile.cards }).map((_, index) => (
            <div key={`panel-${index}`} className="content-skeleton__panel shimmer">
              <div className="content-skeleton__line content-skeleton__line--md" />
              <div className="content-skeleton__line content-skeleton__line--lg" />
              <div className="content-skeleton__line content-skeleton__line--sm" />
            </div>
          ))}
        </div>
      )}

      {overlay ? <div className="content-skeleton__overlay">{overlay}</div> : null}
    </div>
  );
}

function Inner() {
  const offlineState = useOfflineDetection(BACKEND_API);
  const watchdog = useWatchdog();
  const [page, setPage] = useState<Page>("downloader");
  const [pageRevision, setPageRevision] = useState(0);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("starting");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [backendCoreReady, setBackendCoreReady] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState(0);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthPayload | null>(null);
  const [startupDiagnostics, setStartupDiagnostics] = useState<StartupDiagnosticsPayload | null>(null);
  const [startupAgeMs, setStartupAgeMs] = useState(0);
  const [recoveryActionId, setRecoveryActionId] = useState("");
  const [recoveryFeedback, setRecoveryFeedback] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const [autoRecovery, setAutoRecovery] = useState<AutoRecoveryState | null>(null);
  const [autoRecoveryAttempts, setAutoRecoveryAttempts] =
    useState<Partial<Record<PageServiceIssue["serviceKey"], number>>>({});
  const [bootVisualProgress, setBootVisualProgress] = useState(8);
  const [bootOverlayVisible, setBootOverlayVisible] = useState(true);
  const [initialLaunchComplete, setInitialLaunchComplete] = useState(false);
  const onlineStateRef = useRef(offlineState.isOffline);
  const autoRecoveryInFlightRef = useRef<PageServiceIssue["serviceKey"] | null>(null);
  const autoRecoveryLastResetRef = useRef<Partial<Record<PageServiceIssue["serviceKey"], number>>>({});
  const autoRecoveryLastRestartRef = useRef<Partial<Record<PageServiceIssue["serviceKey"], number>>>({});
  const autoRecoveryAttemptRef = useRef<Partial<Record<PageServiceIssue["serviceKey"], number>>>({});

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
      const coreReady = await waitForBackendCoreReady(75000, 250);
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
    void syncDownloads();
    const interval = window.setInterval(() => {
      void syncRuntimeHealth();
      void syncDownloads();
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
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setStartupAgeMs(Date.now() - startedAt);
    }, 300);
    return () => window.clearInterval(interval);
  }, []);

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
    downloader: <ErrorBoundary section="Downloader"><DownloaderPage /></ErrorBoundary>,
    converter:  <ErrorBoundary section="Converter"><ConverterPage /></ErrorBoundary>,
    library:    <ErrorBoundary section="Library"><LibraryPage /></ErrorBoundary>,
    anime:      <ErrorBoundary section="Anime"><AnimePage /></ErrorBoundary>,
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

  const refreshRuntimeSnapshot = async () => {
    invalidateRuntimeRecoveryCaches();
    try {
      const diagnostics = await fetchStartupDiagnostics();
      setStartupDiagnostics(diagnostics);
    } catch {
      // ignore diagnostics refresh failures
    }

    try {
      const ping = await fetchBackendPing();
      setBackendCoreReady(Boolean(ping.core_ready));
    } catch {
      setBackendCoreReady(false);
    }

    await refreshRuntimeHealth();
  };

  const runRecoveryAction = async (
    actionId: string,
    action: () => Promise<string | void>,
    options?: { refreshAfter?: boolean }
  ) => {
    setRecoveryFeedback("");
    setRecoveryError("");
    setRecoveryActionId(actionId);
    try {
      const message = await action();
      if (message) {
        setRecoveryFeedback(message);
      }
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : "Recovery action could not be completed.");
    } finally {
      if (options?.refreshAfter !== false) {
        await refreshRuntimeSnapshot();
      }
      setRecoveryActionId("");
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

  const pageServiceIssue = getPageServiceIssue(page, runtimeHealth);
  const autoRecoveryCandidate = getAutoRecoveryCandidate(page, runtimeHealth);
  const startupGateSatisfied = Boolean(
    backendCoreReady &&
    runtimeHealth?.summary.backend_reachable &&
    runtimeHealth?.summary.startup_ready
  );
  const startupOverlayVisible = runtimeState !== "offline" && !startupGateSatisfied;
  const rawNetworkRecoveryVisible =
    !startupOverlayVisible &&
    offlineState.isOffline &&
    offlineState.reason === "network" &&
    NETWORK_REQUIRED_PAGES.has(page);
  const rawBackendRecoveryVisible =
    !startupOverlayVisible &&
    !rawNetworkRecoveryVisible &&
    (offlineState.reason === "backend" || watchdog.status === "failed");
  const rawServiceBlockingVisible =
    !startupOverlayVisible &&
    !rawNetworkRecoveryVisible &&
    !rawBackendRecoveryVisible &&
    pageServiceIssue !== null;
  const bootShouldStayVisible =
    !initialLaunchComplete &&
    (startupOverlayVisible || rawBackendRecoveryVisible || rawServiceBlockingVisible);
  const networkRecoveryVisible = !bootShouldStayVisible && rawNetworkRecoveryVisible;
  const backendRecoveryVisible = !bootShouldStayVisible && rawBackendRecoveryVisible;
  const serviceBlockingVisible = !bootShouldStayVisible && rawServiceBlockingVisible;
  const onlyConsumetDegraded = isOnlyConsumetDegraded(runtimeHealth);
  const startupTitle = !backendCoreReady
    ? "Opening GRABIX"
    : !runtimeHealth?.summary.backend_reachable
      ? "Connecting to GRABIX"
      : !runtimeHealth.summary.startup_ready
        ? "Finishing startup"
        : "Ready";
  const startupDetail = !backendCoreReady
    ? "Starting the core services."
    : !runtimeHealth?.summary.backend_reachable
      ? "Connecting to the local GRABIX services."
      : !runtimeHealth.summary.startup_ready
        ? "Final checks are still running."
        : "Everything is ready.";
  const bootCaption = !backendCoreReady
    ? "Starting the app"
    : !runtimeHealth?.summary.backend_reachable
      ? "Connecting to services"
      : !runtimeHealth.summary.startup_ready
        ? "Final startup checks"
        : "Ready";
  const currentServiceAttemptCount = pageServiceIssue
    ? autoRecoveryAttempts[pageServiceIssue.serviceKey] ?? 0
    : 0;
  const bootProgressTarget = !bootShouldStayVisible
    ? 100
    : !backendCoreReady
      ? Math.min(72, 8 + startupAgeMs / 85)
      : !runtimeHealth?.summary.backend_reachable
        ? Math.min(86, 62 + startupAgeMs / 105)
        : !runtimeHealth.summary.startup_ready
          ? Math.min(98.4, 80 + startupAgeMs / 260)
          : Math.min(99.2, 96 + startupAgeMs / 800);
  const bootProgress = bootVisualProgress;
  const sidebarStatusOverride = startupOverlayVisible
    ? startupTitle
    : serviceBlockingVisible && pageServiceIssue?.serviceKey === "consumet"
      ? "Getting Anime Ready"
      : autoRecovery
        ? `Checking ${autoRecovery.label}`
        : runtimeState === "degraded" && onlyConsumetDegraded
          ? "Anime fallback is active"
          : undefined;
  const sidebarStatusTone = startupOverlayVisible || serviceBlockingVisible || Boolean(autoRecovery)
    ? "busy"
    : runtimeState === "degraded" && onlyConsumetDegraded
      ? "online"
      : undefined;

  useEffect(() => {
    if (bootShouldStayVisible) {
      setBootOverlayVisible(true);
    }
  }, [bootShouldStayVisible]);

  useEffect(() => {
    if (initialLaunchComplete) return;
    if (startupGateSatisfied && !rawBackendRecoveryVisible && !rawServiceBlockingVisible) {
      setInitialLaunchComplete(true);
    }
  }, [initialLaunchComplete, rawBackendRecoveryVisible, rawServiceBlockingVisible, startupGateSatisfied]);

  useEffect(() => {
    if (!bootOverlayVisible) return;

    const intervalId = window.setInterval(() => {
      setBootVisualProgress((current) => {
        const target = bootProgressTarget;
        const remaining = target - current;
        if (remaining <= 0.04) return target;
        const easing = target >= 99 ? 0.045 : target >= 90 ? 0.06 : 0.075;
        const minimumStep = target >= 100 ? 0.7 : target >= 98 ? 0.045 : target >= 90 ? 0.08 : 0.12;
        return Math.min(target, current + Math.max(minimumStep, remaining * easing));
      });
    }, 60);

    return () => window.clearInterval(intervalId);
  }, [bootOverlayVisible, bootProgressTarget]);

  useEffect(() => {
    if (!bootOverlayVisible || bootShouldStayVisible || bootVisualProgress < 99.7) return;

    const timeoutId = window.setTimeout(() => setBootOverlayVisible(false), 140);
    return () => window.clearTimeout(timeoutId);
  }, [bootOverlayVisible, bootShouldStayVisible, bootVisualProgress]);

  useEffect(() => {
    if (!bootShouldStayVisible && !bootOverlayVisible) {
      setBootVisualProgress(100);
    }
  }, [bootOverlayVisible, bootShouldStayVisible]);

  useEffect(() => {
    if (!bootShouldStayVisible) {
      return;
    }

    if (bootVisualProgress > bootProgressTarget) {
      setBootVisualProgress(bootProgressTarget);
      return;
    }
  }, [bootProgressTarget, bootProgress, bootShouldStayVisible, bootVisualProgress]);

  useEffect(() => {
    if (bootShouldStayVisible && bootVisualProgress < 8) {
      setBootVisualProgress(8);
    }
  }, [bootShouldStayVisible, bootVisualProgress]);

  useEffect(() => {
    const wasOffline = onlineStateRef.current;
    onlineStateRef.current = offlineState.isOffline;
    if (wasOffline && !offlineState.isOffline) {
      void refreshRuntimeSnapshot();
    }
  }, [offlineState.isOffline]);

  useEffect(() => {
    if (!runtimeHealth?.services) return;

    setAutoRecoveryAttempts((current) => {
      let changed = false;
      const next = { ...current };

      for (const serviceKey of Object.keys(next) as Array<PageServiceIssue["serviceKey"]>) {
        const status = runtimeHealth.services[serviceKey]?.status;
        if (status && !["degraded", "offline"].includes(status)) {
          delete next[serviceKey];
          delete autoRecoveryAttemptRef.current[serviceKey];
          delete autoRecoveryLastResetRef.current[serviceKey];
          delete autoRecoveryLastRestartRef.current[serviceKey];
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [runtimeHealth]);

  useEffect(() => {
    if (bootShouldStayVisible || networkRecoveryVisible || backendRecoveryVisible) {
      setAutoRecovery(null);
      return;
    }

    let cancelled = false;

    const tick = async () => {
      if (cancelled || autoRecoveryInFlightRef.current || !autoRecoveryCandidate?.retryable) {
        if (!autoRecoveryCandidate && !cancelled) {
          setAutoRecovery(null);
        }
        return;
      }

      const previousAttempts = autoRecoveryAttemptRef.current[autoRecoveryCandidate.serviceKey] ?? 0;
      if (previousAttempts >= MAX_AUTO_RECOVERY_ATTEMPTS) {
        setAutoRecovery(null);
        return;
      }

      const now = Date.now();
      const lastResetAt = autoRecoveryLastResetRef.current[autoRecoveryCandidate.serviceKey] ?? 0;
      const lastRestartAt = autoRecoveryLastRestartRef.current[autoRecoveryCandidate.serviceKey] ?? 0;
      const shouldReset = now - lastResetAt >= getRecoveryBackoffMs(
        AUTO_SERVICE_RESET_INTERVAL_MS,
        previousAttempts,
        18_000
      );
      const shouldRestart =
        shouldAutoRestartConsumet(startupDiagnostics, autoRecoveryCandidate, startupAgeMs) &&
        now - lastRestartAt >= getRecoveryBackoffMs(
          AUTO_SERVICE_RESTART_INTERVAL_MS,
          previousAttempts,
          45_000
        );

      if (!shouldReset && !shouldRestart) {
        return;
      }

      autoRecoveryInFlightRef.current = autoRecoveryCandidate.serviceKey;
      const attempt = previousAttempts + 1;
      autoRecoveryAttemptRef.current[autoRecoveryCandidate.serviceKey] = attempt;
      setAutoRecoveryAttempts((current) => ({
        ...current,
        [autoRecoveryCandidate.serviceKey]: attempt,
      }));

      setAutoRecovery({
        serviceKey: autoRecoveryCandidate.serviceKey,
        label: getServiceLabel(autoRecoveryCandidate.serviceKey),
        attempt,
        phase: shouldRestart ? "restarting" : "retrying",
        message: shouldRestart
          ? `Trying again to get ${getServiceLabel(autoRecoveryCandidate.serviceKey)} ready.`
          : `Checking ${getServiceLabel(autoRecoveryCandidate.serviceKey)} again now.`,
      });

      try {
        if (shouldRestart) {
          autoRecoveryLastRestartRef.current[autoRecoveryCandidate.serviceKey] = now;
          await restartConsumetSidecar();
        }
        if (shouldReset) {
          autoRecoveryLastResetRef.current[autoRecoveryCandidate.serviceKey] = now;
          await resetServiceCircuitBreaker(autoRecoveryCandidate.serviceKey);
        }
      } catch {
        // Keep the screen calm and continue auto-healing on the next interval.
      } finally {
        await refreshRuntimeSnapshot();
        autoRecoveryInFlightRef.current = null;
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, 1800);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    autoRecoveryCandidate,
    backendRecoveryVisible,
    bootShouldStayVisible,
    networkRecoveryVisible,
    startupAgeMs,
    startupDiagnostics,
    startupOverlayVisible,
  ]);

  useEffect(() => {
    if (!serviceBlockingVisible) {
      setRecoveryFeedback("");
      setRecoveryError("");
    }
  }, [serviceBlockingVisible]);

  const retryNow = () => {
    void runRecoveryAction("retry-runtime", async () => {
      if (pageServiceIssue) {
        if (pageServiceIssue.serviceKey === "consumet") {
          const message = await restartConsumetSidecar();
          await resetServiceCircuitBreaker("consumet");
          return message;
        }
        const payload = await resetServiceCircuitBreaker(pageServiceIssue.serviceKey);
        return payload.message;
      }
      return navigator.onLine
        ? "Refreshing GRABIX health now."
        : "Still waiting for an internet connection.";
    });
  };

  const openLogFolder = () => {
    void runRecoveryAction(
      "open-startup-log",
      async () => {
        const opened = await openStartupLog();
        return opened ? "Opened GRABIX diagnostics in Explorer." : "Could not open the startup log.";
      },
      { refreshAfter: false }
    );
  };

  const restartAppNow = () => {
    setRecoveryFeedback("");
    setRecoveryError("");
    void restartGrabix();
  };

  const networkActions: RecoveryAction[] = [
    {
      id: "retry-network",
      label: "Retry Now",
      onClick: retryNow,
      loading: recoveryActionId === "retry-runtime",
    },
    {
      id: "restart-app-network",
      label: "Restart GRABIX",
      variant: "secondary",
      onClick: restartAppNow,
    },
  ];
  const backendActions: RecoveryAction[] = [
    {
      id: "retry-backend",
      label: "Retry Now",
      onClick: retryNow,
      loading: recoveryActionId === "retry-runtime",
    },
    {
      id: "restart-app-backend",
      label: "Restart GRABIX",
      variant: "secondary",
      onClick: restartAppNow,
    },
    {
      id: "open-log-backend",
      label: "Open Startup Log",
      variant: "secondary",
      onClick: openLogFolder,
      loading: recoveryActionId === "open-startup-log",
    },
  ];
  const serviceActions: RecoveryAction[] = [
    {
      id: "retry-service",
      label: getReconnectLabel(pageServiceIssue),
      onClick: retryNow,
      loading: recoveryActionId === "retry-runtime",
    },
    ...(currentServiceAttemptCount >= MANUAL_RESTART_ESCALATION_ATTEMPTS
      ? [{
          id: "restart-app-service",
          label: "Restart GRABIX",
          variant: "secondary" as const,
          onClick: restartAppNow,
        }]
      : []),
  ];
  const showManualServiceActions = currentServiceAttemptCount >= MANUAL_SERVICE_ACTION_ATTEMPTS || Boolean(recoveryError);
  const visibleServiceActions = showManualServiceActions ? serviceActions : [];
  const showServiceRecoveryOverlay =
    serviceBlockingVisible &&
    pageServiceIssue !== null &&
    (showManualServiceActions || Boolean(recoveryFeedback) || Boolean(recoveryError));
  const consumetDiagnosticDetail =
    pageServiceIssue?.serviceKey === "consumet" &&
    startupDiagnostics?.consumet.message &&
    !["started", "reused"].includes(startupDiagnostics.consumet.status)
      ? startupDiagnostics.consumet.message
      : "";
  const serviceDetail =
    autoRecovery && autoRecovery.serviceKey === pageServiceIssue?.serviceKey
      ? `${autoRecovery.message} Attempt ${autoRecovery.attempt}.`
      : currentServiceAttemptCount >= MAX_AUTO_RECOVERY_ATTEMPTS && consumetDiagnosticDetail
        ? `${consumetDiagnosticDetail} Automatic recovery has paused so you can choose the next step.`
        : consumetDiagnosticDetail || pageServiceIssue?.message;

  return (
    <div style={{ position: "relative", display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <OfflineBanner offlineState={offlineState} />
      <WatchdogBanner status={watchdog.status} isBannerVisible={watchdog.isBannerVisible} />
      <Sidebar
        page={page}
        setPage={navigateToPage}
        activeDownloads={activeDownloads}
        runtimeState={runtimeState}
        runtimeHealth={runtimeHealth}
        statusOverride={sidebarStatusOverride}
        statusToneOverride={sidebarStatusTone}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-app)",
          paddingTop: (offlineState.isOffline ? 32 : 0) + (watchdog.isBannerVisible && watchdog.status !== "idle" ? 32 : 0),
          transition: "padding-top 0.2s ease",
        }}
      >
        <RuntimeHealthProvider value={{ health: runtimeHealth, runtimeState, refreshHealth: refreshRuntimeHealth }}>
          {bootShouldStayVisible ? (
            <div style={{ flex: 1 }} />
          ) : networkRecoveryVisible ? (
            <RecoveryStage
              title="No internet connection"
              subtitle="GRABIX needs the internet for this page. Reconnect, then tap retry to continue."
              detail={recoveryError || recoveryFeedback || "Local pages like Library and Settings will still work once the connection is back."}
              icon={<IconWifi size={30} />}
              tone="warning"
              actions={networkActions}
            />
          ) : backendRecoveryVisible ? (
            <RecoveryStage
              title="GRABIX needs a moment"
              subtitle="The app is still trying to get everything ready."
              detail={recoveryError || recoveryFeedback || "Try again in a moment, or restart GRABIX if it stays stuck."}
              icon={<IconAlert size={30} />}
              tone="danger"
              actions={backendActions}
            />
          ) : serviceBlockingVisible && pageServiceIssue ? (
            <ContentSkeletonStage
              page={page}
              title={pageServiceIssue.serviceKey === "consumet" ? "Preparing Anime" : pageServiceIssue.title}
              subtitle={
                pageServiceIssue.serviceKey === "consumet"
                  ? "Anime will appear as soon as it is ready."
                  : "This page will appear as soon as it is ready."
              }
              detail={serviceDetail}
              overlay={showServiceRecoveryOverlay ? (
                <ServiceRecoveryCard
                  title={pageServiceIssue.title}
                  message={pageServiceIssue.message}
                  actions={visibleServiceActions}
                  feedback={recoveryFeedback}
                  error={recoveryError}
                  autoRecovery={autoRecovery}
                />
              ) : undefined}
            />
          ) : (
            <Suspense fallback={<PageLoadingState page={page} />}>
              <div key={`${page}:${pageRevision}`} style={{ display: "flex", flexDirection: "column", flex: 1, width: "100%", minWidth: 0, minHeight: 0, position: "relative" }}>
                {pages[page]}
              </div>
            </Suspense>
          )}
        </RuntimeHealthProvider>
      </main>
      {bootOverlayVisible ? (
        <div className="boot-stage-overlay">
          <BootStage
            title={startupTitle}
            subtitle="Getting GRABIX ready for you."
            detail={startupDetail}
            progress={bootProgress}
            caption={bootCaption}
          />
        </div>
      ) : null}
    </div>
  );
}

function PageLoadingState({ page }: { page: Page }) {
  return (
    <ContentSkeletonStage
      page={page}
      title={getPageSkeletonProfile(page).title}
      subtitle="This page is loading now."
    />
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
