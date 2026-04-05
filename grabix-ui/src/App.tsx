import { Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineBanner } from "./components/OfflineBanner";
import { WatchdogBanner } from "./components/WatchdogBanner";
<<<<<<< HEAD
=======
import { IconAlert, IconRefresh, IconServers, IconWifi } from "./components/Icons";
>>>>>>> parent of ee60160 (Add Supabase auth and bundled runtime-tools)
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
<<<<<<< HEAD
=======
  invalidateRuntimeRecoveryCaches,
  openStartupLog,
>>>>>>> parent of ee60160 (Add Supabase auth and bundled runtime-tools)
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
  const [pageRevision, setPageRevision] = useState(0);
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

  const networkBannerVisible = offlineState.isOffline && offlineState.reason === "network";

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

  const navigateToPage = (nextPage: Page, options?: { refresh?: boolean }) => {
    setPage((current) => {
      if (current === nextPage || options?.refresh) {
        setPageRevision((value) => value + 1);
      }
      return nextPage;
    });
  };

<<<<<<< HEAD
=======
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

>>>>>>> parent of ee60160 (Add Supabase auth and bundled runtime-tools)
  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw", overflow: "hidden" }}>
      <OfflineBanner offlineState={offlineState} />
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
          paddingTop: (offlineState.isOffline ? 32 : 0) + (watchdog.isBannerVisible && watchdog.status !== "idle" ? 32 : 0),
          transition: "padding-top 0.2s ease",
        }}
      >
        <RuntimeHealthProvider value={{ health: runtimeHealth, runtimeState, refreshHealth: refreshRuntimeHealth }}>
<<<<<<< HEAD
          <Suspense fallback={<PageLoadingState page={page} />}>
            <div key={`${page}:${pageRevision}`} style={{ display: "flex", flexDirection: "column", flex: 1, width: "100%", minWidth: 0, minHeight: 0 }}>
              {pages[page]}
            </div>
          </Suspense>
=======
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
>>>>>>> parent of ee60160 (Add Supabase auth and bundled runtime-tools)
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
