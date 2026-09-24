/** Settings uses decimal units consistently; exact counts remain available alongside rounded values. */
export function formatStorageBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value, unit = 0;
  while (size >= 1000 && unit < units.length - 1) { size /= 1000; unit++; }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function exactStorageBytes(value: number) {
  return `${value.toLocaleString()} bytes (decimal KB/MB/GB)`;
}

export function formatStorageTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(date);
}
