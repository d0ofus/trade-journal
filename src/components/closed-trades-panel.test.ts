import { afterEach, describe, expect, it } from "vitest";

import { formatDateTimeLabel, formatTimeLabel } from "@/components/closed-trades-panel";

const originalTimezone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimezone;
});

describe("closed-trade execution timestamp formatting", () => {
  it("stays identical across server and browser timezone environments", () => {
    process.env.TZ = "UTC";
    const serverTime = formatTimeLabel("2026-07-10T09:33:00.000Z");
    const serverDateTime = formatDateTimeLabel("2026-07-10T09:33:00.000Z");

    process.env.TZ = "Australia/Sydney";
    expect(formatTimeLabel("2026-07-10T09:33:00.000Z")).toBe(serverTime);
    expect(formatDateTimeLabel("2026-07-10T09:33:00.000Z")).toBe(serverDateTime);
    expect(serverTime).toBe("09:33");
    expect(serverDateTime).toBe("Jul 10, 2026 09:33");
  });
});
