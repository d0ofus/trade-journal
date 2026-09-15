import { executionTimeResolved } from "./execution-time-provenance";
import { brokerTimeLabel } from "./timestamp-interpretation";
import type { Execution } from "./types";

export const utcTimeLabel = (time: number) => new Date(time * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");

export function executionTimeDisplay(execution: Execution) {
  const provenance = execution.provenance;
  const resolved = executionTimeResolved(execution) &&
    (!provenance?.interpretationStatus || provenance.interpretationStatus === "applied");
  const utc = utcTimeLabel(execution.time);
  if (resolved && provenance?.timezone === "America/New_York") {
    return { label: "Execution time", time: brokerTimeLabel(execution.time, "America/New_York"), utc };
  }
  if (resolved && provenance?.timezone === "Explicit offset" && provenance.brokerWallTime) {
    return { label: "Execution time", time: provenance.brokerWallTime, utc };
  }
  return { label: resolved ? "Execution time" : "Stored time (timezone unresolved)", time: utc, utc: null };
}
