import { getCachedJson } from "./cache";
import { invoke } from "@tauri-apps/api/core";
export const BACKEND_OFFLINE_MESSAGE = "GRABIX backend is offline. Start the backend and try again.";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const BACKEND_API = trimTrailingSlash(
  import.meta.env.VITE_GRABIX_API_BASE || "http://127.0.0.1:8000"
);

export interface RuntimeServiceStatus {
  name: string;
  status: "online" | "degraded" | "offline";
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

export interface RuntimeHealthPayload {
  services: Record<string, RuntimeServiceStatus>;
  capabilities: {
    startup_ready: boolean;
    can_show_shell: boolean;
    can_open_library: boolean;
    can_download_media: boolean;
    can_use_converter: boolean;
    can_browse_movies: boolean;
    can_browse_tv: boolean;
    can_use_moviebox: boolean;
    can_play_anime: boolean;
    can_play_anime_primary: boolean;
    can_play_anime_fallback: boolean;
    can_read_manga: boolean;
  };
  summary: {
    online: number;
    degraded: number;
    offline: number;
    backend_reachable: boolean;
    startup_ready: boolean;
    degraded_services: string[];
  };
}

export interface BackendPingPayload {
  ok: boolean;
  core_ready: boolean;
  services: Record<string, RuntimeServiceStatus>;
}

export type RuntimeState = "starting" | "ready" | "degraded" | "recovering" | "offline";

export interface StartupSidecarDiagnostic {
  name: string;
  status: string;
  message: string;
  failure_code?: string;
  port: number;
  binary_path: string;
}

export interface StartupDesktopAuthDiagnostic {
  required: boolean;
  ready: boolean;
  mode: string;
  message: string;
  token_path: string;
  app_state_root: string;
}

export interface StartupDiagnosticsPayload {
  app_mode: string;
  build_id?: string;
  backend_resource_hash?: string;
  startup_ready: boolean;
  log_path: string;
  diagnostics_path: string;
  resource_dir: string;
  backend: StartupSidecarDiagnostic;
  consumet: StartupSidecarDiagnostic;
  desktop_auth?: StartupDesktopAuthDiagnostic;
}

export interface DiagnosticsLogEvent {
  timestamp: string;
  level: string;
  service: string;
  event: string;
  correlation_id: string;
  message: string;
  details: Record<string, unknown>;
}

export interface DiagnosticsLogsPayload {
  backend_log_path: string;
  events: DiagnosticsLogEvent[];
}

export interface BackendRequestContext {
  desktop_auth_token: string;
  desktop_auth_required: boolean;
  app_mode: string;
}

let backendRequestContextPromise: Promise<BackendRequestContext> | null = null;
let cloudAccessTokenResolver: (() => Promise<string | null> | string | null) | null = null;

function normalizeHeaders(input?: HeadersInit): Headers {
  return new Headers(input || {});
}

async function getBackendRequestContext(): Promise<BackendRequestContext> {
  if (!backendRequestContextPromise) {
    backendRequestContextPromise = invoke<BackendRequestContext>("get_backend_request_context")
      .catch(() => ({
        desktop_auth_token: "",
        desktop_auth_required: false,
        app_mode: "browser",
      }));
  }
  return backendRequestContextPromise;
}

async function buildBackendRequestInit(init?: RequestInit, sensitive = false): Promise<RequestInit> {
  const nextInit: RequestInit = { ...(init || {}) };
  const headers = normalizeHeaders(init?.headers);
  if (!headers.has("Authorization") && cloudAccessTokenResolver) {
    const resolvedToken = await cloudAccessTokenResolver();
    if (resolvedToken) {
      headers.set("Authorization", `Bearer ${resolvedToken}`);
    }
  }
  if (sensitive) {
    const context = await getBackendRequestContext();
    if (context.desktop_auth_token) {
      headers.set("X-Grabix-Desktop-Auth", context.desktop_auth_token);
    }
  }
  nextInit.headers = headers;
  return nextInit;
}

export function setCloudAccessTokenResolver(
  resolver: (() => Promise<string | null> | string | null) | null
) {
  cloudAccessTokenResolver = resolver;
}

export function extractBackendErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  if (typeof record.detail === "string" && record.detail.trim()) {
    return record.detail.trim();
  }
  if (record.detail && typeof record.detail === "object") {
    const detailRecord = record.detail as Record<string, unknown>;
    if (typeof detailRecord.message === "string" && detailRecord.message.trim()) {
      return detailRecord.message.trim();
    }
  }
  return fallback;
}

export function deriveRuntimeState(options: {
  health: RuntimeHealthPayload | null;
  startupDiagnostics?: StartupDiagnosticsPayload | null;
  bootstrapping?: boolean;
  backendCoreReady?: boolean;
}): RuntimeState {
  const { health, startupDiagnostics, bootstrapping, backendCoreReady } = options;
  if (bootstrapping && !health) {
    return "starting";
  }
  if (!health) {
    if (backendCoreReady) {
      return "recovering";
    }
    const startupStatuses = [startupDiagnostics?.backend.status, startupDiagnostics?.consumet.status].filter(Boolean);
    if (startupStatuses.some((status) => status === "starting" || status === "recovering")) {
      return "starting";
    }
    return "offline";
  }
  if (!health.summary.backend_reachable) {
    return bootstrapping ? "starting" : "offline";
  }
  if (!health.summary.startup_ready) {
    return "recovering";
  }
  if ((health.summary.degraded_services?.length ?? 0) > 0) {
    return "degraded";
  }
  return "ready";
}

export async function fetchRuntimeHealth(): Promise<RuntimeHealthPayload> {
  return await getCachedJson<RuntimeHealthPayload>({
    key: "runtime:health",
    url: `${BACKEND_API}/health/capabilities`,
    ttlMs: 2500,
    scope: "memory",
    mapError: async () => BACKEND_OFFLINE_MESSAGE,
  });
}

export async function fetchBackendPing(): Promise<BackendPingPayload> {
  return await getCachedJson<BackendPingPayload>({
    key: "runtime:ping",
    url: `${BACKEND_API}/health/ping`,
    ttlMs: 1200,
    scope: "memory",
    mapError: async () => BACKEND_OFFLINE_MESSAGE,
  });
}

export async function checkBackendReady(): Promise<boolean> {
  try {
    const payload = await fetchRuntimeHealth();
    return Boolean(payload.summary.backend_reachable);
  } catch {
    return false;
  }
}

export async function waitForBackendReady(timeoutMs = 20000, intervalMs = 600): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkBackendReady()) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function waitForBackendCoreReady(timeoutMs = 25000, intervalMs = 500): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchBackendPing();
      if (payload.ok && payload.core_ready) {
        return true;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  return false;
}

export async function waitForRuntimeHealth(timeoutMs = 20000, intervalMs = 600): Promise<RuntimeHealthPayload | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchRuntimeHealth();
      if (payload.summary.backend_reachable) {
        return payload;
      }
    } catch {
      // keep waiting
    }
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
  return null;
}

export async function backendFetch(
  input: string,
  init?: RequestInit,
  options?: { sensitive?: boolean }
): Promise<Response> {
  try {
    const requestInit = await buildBackendRequestInit(init, options?.sensitive === true);
    return await fetch(input.startsWith("http") ? input : `${BACKEND_API}${input}`, requestInit);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : BACKEND_OFFLINE_MESSAGE);
  }
}

export async function backendJson<T>(
  input: string,
  init?: RequestInit,
  options?: { sensitive?: boolean }
): Promise<T> {
  const response = await backendFetch(input, init, options);
  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    throw new Error(extractBackendErrorMessage(payload, `Request failed with ${response.status}`));
  }
  return (await response.json()) as T;
}

export async function fetchStartupDiagnostics(): Promise<StartupDiagnosticsPayload | null> {
  try {
    return await invoke<StartupDiagnosticsPayload>("get_startup_diagnostics");
  } catch {
    return null;
  }
}

export async function openStartupLog(): Promise<string | null> {
  try {
    return await invoke<string>("open_startup_log");
  } catch {
    return null;
  }
}

export async function fetchDiagnosticsLogs(limit = 20): Promise<DiagnosticsLogsPayload> {
  return await getCachedJson<DiagnosticsLogsPayload>({
    key: `diagnostics:logs:${limit}`,
    url: `${BACKEND_API}/diagnostics/logs?limit=${limit}`,
    ttlMs: 2500,
    scope: "memory",
    mapError: async () => BACKEND_OFFLINE_MESSAGE,
  });
}
