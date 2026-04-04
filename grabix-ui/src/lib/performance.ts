import { readJsonStorage, versionedStorageKey, writeJsonStorage } from "./persistentState";

type PerfMetric = {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

const PERF_STORAGE_KEY = versionedStorageKey("grabix:perf-metrics", "v2");
const perfMarks = new Map<string, number>();

function readMetrics(): PerfMetric[] {
  const value = readJsonStorage<unknown>("session", PERF_STORAGE_KEY, []);
  return Array.isArray(value) ? (value as PerfMetric[]) : [];
}

function writeMetrics(metrics: PerfMetric[]) {
  writeJsonStorage("session", PERF_STORAGE_KEY, metrics.slice(-40));
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
  writeMetrics([...readMetrics(), metric]);
  perfMarks.delete(name);
  return metric;
}

export function getPerfMetrics(): PerfMetric[] {
  return readMetrics();
}
