import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireBearerSecret: vi.fn(),
  runFlexImport: vi.fn(),
}));

vi.mock("@/lib/server/api-auth", () => ({ requireBearerSecret: mocks.requireBearerSecret }));
vi.mock("@/lib/server/flex-service", () => ({ runFlexImport: mocks.runFlexImport }));

describe("/api/cron/flex-import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBearerSecret.mockReturnValue(null);
    mocks.runFlexImport.mockResolvedValue({ positions: { rowsImported: 1 } });
  });

  it("stops before Flex work when the cron secret is rejected", async () => {
    mocks.requireBearerSecret.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/cron/flex-import"));

    expect(response.status).toBe(401);
    expect(mocks.runFlexImport).not.toHaveBeenCalled();
  });

  it("returns the completed service result", async () => {
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/cron/flex-import"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { positions: { rowsImported: 1 } } });
  });

  it("reports lifecycle failures as an unsuccessful cron run", async () => {
    mocks.runFlexImport.mockRejectedValue(new Error("Materialization refresh failed"));
    const { GET } = await import("./route");
    const response = await GET(new NextRequest("http://localhost/api/cron/flex-import"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Materialization refresh failed" });
  });
});
