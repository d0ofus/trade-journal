import { describe, it, expect } from "vitest";
import { tradeViewSchema } from "./trade-view";
import { backupReminderDue } from "../server/backup-reminder";
describe("saved chart view validation", () => {
  const view = { version: 1, arrangement: "left", panels: [{ id: "chart-1", interval: "5m", session: "extended", range: { from: 1700000000, to: 1700086400 } }] };
  it("rejects unknown versions, reversed ranges and duplicate panels", () => {
    expect(tradeViewSchema.safeParse(view).success).toBe(true);
    expect(tradeViewSchema.safeParse({ ...view, version: 2 }).success).toBe(false);
    expect(tradeViewSchema.safeParse({ ...view, panels: [view.panels[0], view.panels[0]] }).success).toBe(false);
    expect(tradeViewSchema.safeParse({ ...view, panels: [{ ...view.panels[0], range: { from: 20, to: 10 } }] }).success).toBe(false);
  });
  it("reminds only for unbacked changes after a week or without any verified backup", () => {
    const now = Date.now();
    expect(backupReminderDue(true, null, now)).toBe(false);
    expect(backupReminderDue(false, null, now)).toBe(true);
    expect(backupReminderDue(false, new Date(now - 6 * 86400_000), now)).toBe(false);
    expect(backupReminderDue(false, new Date(now - 8 * 86400_000), now)).toBe(true);
  });
});
