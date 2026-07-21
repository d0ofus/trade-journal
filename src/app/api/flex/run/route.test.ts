import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rejectE2eBlockedMutation: vi.fn(),
  requireApiSessionOrBearerSecret: vi.fn(),
  runFlexImport: vi.fn(),
}));

vi.mock("@/lib/server/api-auth", () => ({
  requireApiSessionOrBearerSecret: mocks.requireApiSessionOrBearerSecret,
}));
vi.mock("@/lib/server/e2e-demo-write-guard", () => ({
  rejectE2eBlockedMutation: mocks.rejectE2eBlockedMutation,
}));
vi.mock("@/lib/server/flex-service", () => ({ runFlexImport: mocks.runFlexImport }));

describe("/api/flex/run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSessionOrBearerSecret.mockResolvedValue(null);
    mocks.rejectE2eBlockedMutation.mockReturnValue(null);
    mocks.runFlexImport.mockResolvedValue({ trades: { rowsImported: 1 } });
  });

  it("stops before mutation when authentication fails", async () => {
    mocks.requireApiSessionOrBearerSecret.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/flex/run", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.rejectE2eBlockedMutation).not.toHaveBeenCalled();
    expect(mocks.runFlexImport).not.toHaveBeenCalled();
  });

  it("returns the completed service result", async () => {
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/flex/run", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: { trades: { rowsImported: 1 } } });
  });

  it("reports lifecycle failures as an unsuccessful request", async () => {
    mocks.runFlexImport.mockRejectedValue(new Error("Final import status update failed"));
    const { POST } = await import("./route");
    const response = await POST(new NextRequest("http://localhost/api/flex/run", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "Final import status update failed" });
  });
});
