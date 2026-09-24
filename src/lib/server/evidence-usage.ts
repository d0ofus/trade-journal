/** Provider metrics are optional. Missing counters must never masquerade as zero usage. */
export function parseR2AccountMetrics(value: unknown): { standardBytes: number; otherClassBytes: number | null } | null {
  if (!value || typeof value !== "object") return null;
  const metrics = value as Record<string, unknown>;
  const size = (storage: unknown): number | null => {
    if (!storage || typeof storage !== "object") return null;
    let total = 0;
    for (const kind of ["published", "uploaded"]) {
      const counters = (storage as Record<string, unknown>)[kind];
      if (!counters || typeof counters !== "object") return null;
      for (const name of ["payloadSize", "metadataSize"]) {
        const n = (counters as Record<string, unknown>)[name];
        if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) return null;
        total += n;
      }
    }
    return Number.isSafeInteger(total) ? total : null;
  };
  const standardBytes = size(metrics.standard);
  return standardBytes === null ? null : { standardBytes, otherClassBytes: size(metrics.infrequentAccess) };
}
