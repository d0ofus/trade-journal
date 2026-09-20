import type { DockviewApi, SerializedDockview } from "dockview";
import type { WorkspacePreferences } from "@/lib/workstation/types";

export const reviewPanelIds = ["executions", "evidence", "drawings"] as const;

/** Hide groups without destroying their panels, sizes, active tabs, or draft editors. */
export function applyWorkspaceVisibility(
  api: DockviewApi,
  preferences: WorkspacePreferences,
  focusJournal = false,
) {
  for (const group of api.groups) {
    const ids = group.panels.map((panel) => panel.id);
    const isCharts = ids.includes("charts");
    const onlyReviewTools =
      ids.length > 0 &&
      ids.every((id) => reviewPanelIds.some((tool) => tool === id));
    const onlyJournal = ids.length === 1 && ids[0] === "journal";
    const visible = preferences.focusMode
      ? isCharts || (onlyJournal && focusJournal)
      : onlyReviewTools
        ? !preferences.bottomCollapsed
        : onlyJournal
          ? preferences.journal
          : true;
    if (group.api.isVisible !== visible) group.api.setVisible(visible);
    // Dockview can retain zero-sized/offscreen panel DOM. Do not leave its
    // editors keyboard-accessible while the group is hidden.
    group.element.style.visibility = visible ? "" : "hidden";
  }
}

export type FocusDockState = { snapshot: SerializedDockview | null };
/** Temporary arrangement: never persist focus-only moves, resizes or visibility. */
export function syncFocusDock(api: DockviewApi, preferences: WorkspacePreferences, state: FocusDockState, journalOpen: boolean) {
  if (preferences.focusMode && !state.snapshot) {
    state.snapshot = api.toJSON();
    const charts = api.getPanel("charts");
    if (charts) {
      if (charts.group.panels.length > 1) charts.api.moveTo({ position: "left", skipSetActive: true });
      const journal = api.getPanel("journal") ?? api.addPanel({ id: "journal", component: "panel", title: "JOURNAL", position: { referencePanel: "charts", direction: "right" }, minimumWidth: 270 });
      journal.api.moveTo({ group: charts.group, position: "right", skipSetActive: true });
      journal.api.setSize({ width: 322 });
      charts.api.setActive();
    }
  } else if (!preferences.focusMode && state.snapshot) {
    // Keep the guard in place while fromJSON emits intermediate layout events.
    api.fromJSON(state.snapshot, { reuseExistingPanels: true });
    state.snapshot = null;
  }
  applyWorkspaceVisibility(api, preferences, journalOpen);
}
