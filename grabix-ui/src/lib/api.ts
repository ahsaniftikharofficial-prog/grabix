export const BACKEND_OFFLINE_MESSAGE = "GRABIX backend is offline. Start the backend and try again.";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const BACKEND_API = trimTrailingSlash(
  import.meta.env.VITE_GRABIX_API_BASE || "http://127.0.0.1:8000"
);

export async function checkBackendReady(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_API}/ffmpeg-status`);
    return response.ok;
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

export async function backendFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input.startsWith("http") ? input : `${BACKEND_API}${input}`, init);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : BACKEND_OFFLINE_MESSAGE);
  }
}
