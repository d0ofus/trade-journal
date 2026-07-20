const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEGACY_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const axisDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function formatDashboardAxisDate(value: string) {
  if (!value) return value;

  let normalized = value;
  if (DATE_ONLY_PATTERN.test(value)) {
    normalized = `${value}T00:00:00.000Z`;
  } else if (LEGACY_DATE_TIME_PATTERN.test(value)) {
    normalized = `${value.replace(" ", "T")}:00.000Z`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return value;
  return axisDateFormatter.format(parsed);
}
