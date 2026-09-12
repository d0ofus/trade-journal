import { after } from "next/server";
import { preparationEnabled } from "./workstation-cache-store";

/** Invoked after successful materialization only. Neither registration nor execution may alter import outcomes. */
export function prepareCandlesAfterResponse() {
  if (!preparationEnabled()) return;
  try {
    after(async () => {
      try { const { recoverCandlePreparation } = await import("./workstation-cache-jobs"); await recoverCandlePreparation(); }
      catch { console.warn("Chart preparation deferred to daily recovery. Import results are unchanged."); }
    });
  } catch { console.warn("Chart preparation registration deferred to daily recovery."); }
}
