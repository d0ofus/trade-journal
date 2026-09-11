import type { DockviewApi } from "dockview";
import type { WorkspacePreferences } from "@/lib/workstation/types";

export const reviewPanelIds = ["executions", "evidence", "drawings"] as const;

/** Hide groups without destroying their panels, sizes, active tabs, or draft editors. */
export function applyWorkspaceVisibility(
  api: DockviewApi,
  preferences: WorkspacePreferences,
) {
  for (const group of api.groups) {
    const ids = group.panels.map((panel) => panel.id);
    const isCharts = ids.includes("charts");
    const onlyReviewTools =
      ids.length > 0 &&
      ids.every((id) => reviewPanelIds.some((tool) => tool === id));
    const onlyJournal = ids.length === 1 && ids[0] === "journal";
    const visible = preferences.focusMode
      ? isCharts
      : onlyReviewTools
        ? !preferences.bottomCollapsed
        : onlyJournal
          ? preferences.journal
          : true;
    if (group.api.isVisible !== visible) group.api.setVisible(visible);
  }
}
