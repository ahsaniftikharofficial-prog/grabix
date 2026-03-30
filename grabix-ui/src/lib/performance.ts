type PerfMetric = {
  name: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

const PERF_STORAGE_KEY = "grabix:perf-metrics";
const perfMarks = new Map<string, number>();

function readMetrics(): PerfMetric[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(PERF_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PerfMetric[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMetrics(metrics: PerfMetric[]) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PERF_STORAGE_KEY, JSON.stringify(metrics.slice(-40)));
  } catch {
    // Ignore storage failures.
  }
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
