import type { Execution } from "./types";

export const timePolicyModes = ["verified-reports", "confirmed-flex-new-york"] as const;
export type TimePolicyMode = (typeof timePolicyModes)[number];
export const timePolicyMode = (basis?: string): TimePolicyMode => basis === "confirmed-flex-new-york" ? basis : "verified-reports";
export const executionTimeResolved = (execution: Execution) => execution.provenance?.timezoneStatus === "verified" || execution.provenance?.timezoneStatus === "user-confirmed";
export const executionTimezoneLabel = (execution: Execution) => execution.provenance?.timezoneStatus === "user-confirmed"
  ? execution.provenance.timezone === "Explicit offset" ? "Explicit source offset — user-confirmed" : "New York time — user-confirmed"
  : executionTimeResolved(execution) ? "Verified source timezone" : "Source timezone unverified; stored time displayed as UTC";
