import { performance } from "node:perf_hooks";

const diagnosticsEnabled =
  process.env.APP_DIAGNOSTICS === "1" ||
  process.env.APP_DIAGNOSTICS === "true" ||
  process.env.NODE_ENV === "development";

export async function withDiagnostics<T>(
  label: string,
  fn: (step: <R>(name: string, callback: () => Promise<R> | R) => Promise<R>) => Promise<T>,
): Promise<T> {
  if (!diagnosticsEnabled) {
    return fn(async (_name, callback) => Promise.resolve(callback()));
  }

  const startedAt = performance.now();
  const steps: Array<{ name: string; durationMs: number }> = [];

  const step = async <R>(name: string, callback: () => Promise<R> | R): Promise<R> => {
    const stepStartedAt = performance.now();
    try {
      return await callback();
    } finally {
      steps.push({
        name,
        durationMs: Number((performance.now() - stepStartedAt).toFixed(1)),
      });
    }
  };

  try {
    return await fn(step);
  } finally {
    const totalMs = Number((performance.now() - startedAt).toFixed(1));
    const breakdown = steps.map((entry) => `${entry.name}=${entry.durationMs}ms`).join(" | ");
    console.info(`[diagnostics] ${label} total=${totalMs}ms${breakdown ? ` | ${breakdown}` : ""}`);
  }
}
