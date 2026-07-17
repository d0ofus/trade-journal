const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcDateBoundary(value: string, boundary: "start" | "end") {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid date filter: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`Invalid date filter: ${value}`);
  }

  return boundary === "start" ? date : new Date(timestamp + 24 * 60 * 60 * 1000 - 1);
}
