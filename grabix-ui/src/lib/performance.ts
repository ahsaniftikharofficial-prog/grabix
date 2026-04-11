import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "./persistentState";

type PerfMetric = {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

const PERF_STORAGE_KEY = versionedStorageKey("grabix:perf-metrics", "v2");
const perfMarks = new Map<string, number>();
const bufferedMetrics: PerfMetric[] = [];
const FLUSH_INTERVAL_MS = 10_000;
let perfFlusherStarted = false;

function readStoredMetrics(): PerfMetric[] {
  const value = readJsonStorage<unknown>("session", PERF_STORAGE_KEY, []);
  return Array.isArray(value) ? (value as PerfMetric[]) : [];
}

function writeMetrics(metrics: PerfMetric[]) {
  writeJsonStorage("session", PERF_STORAGE_KEY, metrics.slice(-40));
}

function flushMetricsBuffer() {
  if (bufferedMetrics.length === 0) return;
  const snapshot = bufferedMetrics.splice(0, bufferedMetrics.length);
  writeMetrics([...readStoredMetrics(), ...snapshot]);
}

function ensurePerfFlusher() {
  if (perfFlusherStarted || typeof window === "undefined") return;
  perfFlusherStarted = true;
  window.setInterval(flushMetricsBuffer, FLUSH_INTERVAL_MS);
  window.addEventListener("beforeunload", flushMetricsBuffer);
}

export function markPerf(name: string) {
  perfMarks.set(name, performance.now());
}

export function measurePerf(name: string): PerfMetric | null {
  const startedAt = perfMarks.get(name);
  if (startedAt == null) return null;
  const endedAt = performance.now();
  const metric: PerfMetric = {
    name,
    startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - startedAt),
  };
  perfMarks.delete(name);
  bufferedMetrics.push(metric);
  ensurePerfFlusher();
  return metric;
}

export function getPerfMetrics(): PerfMetric[] {
  return [...readStoredMetrics(), ...bufferedMetrics].slice(-40);
}
