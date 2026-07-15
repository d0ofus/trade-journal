export type DesiredSaveAction = "cancel" | "ignore" | "queue";

export function reconcileDesiredSave({
  desiredSignature,
  inFlight,
  queuedSignature,
  savedSignature,
}: {
  desiredSignature: string;
  inFlight: boolean;
  queuedSignature: string;
  savedSignature: string;
}): DesiredSaveAction {
  if (desiredSignature === savedSignature) return inFlight ? "queue" : "cancel";
  if (desiredSignature === queuedSignature) return "ignore";
  return "queue";
}

export function nextPendingSaveAfterSuccess<T extends { signature: string }>(
  completedSignature: string,
  pending: T | null,
): T | null {
  if (!pending || pending.signature === completedSignature) return null;
  return pending;
}
