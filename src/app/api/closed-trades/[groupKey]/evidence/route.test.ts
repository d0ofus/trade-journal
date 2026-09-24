import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
const mocks = vi.hoisted(() => ({ session: vi.fn(), trade: vi.fn(), asset: vi.fn(), create: vi.fn(), finalize: vi.fn(), status: vi.fn(), cancel: vi.fn(), sign: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { evidenceAsset: { findFirst: mocks.asset } } }));
vi.mock("@/lib/server/evidence-assets", () => ({ assertEvidenceTrade: mocks.trade, createEvidenceUpload: mocks.create, finalizeEvidenceUpload: mocks.finalize, evidenceUploadStatus: mocks.status, cancelEvidenceUpload: mocks.cancel }));
vi.mock("@/lib/server/evidence-r2", async original => ({ ...await original<typeof import("@/lib/server/evidence-r2")>(), signEvidenceGet: mocks.sign }));
const context = { params: Promise.resolve({ groupKey: "authorized-trade" }) };
const request = (body: unknown, origin = "https://journal.invalid") => new NextRequest("https://journal.invalid/api/closed-trades/authorized-trade/evidence", { method: "POST", headers: { Origin: origin }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); mocks.session.mockResolvedValue({ user: { id: "authorized-owner" } }); mocks.sign.mockResolvedValue("https://private.invalid/short-lived"); });
afterEach(() => vi.unstubAllEnvs());
describe("authenticated private evidence metadata interface", () => {
  it("rejects unauthenticated and cross-origin access before storage", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await GET(new NextRequest("https://journal.invalid/api?asset=one"), context)).status).toBe(401);
    mocks.session.mockResolvedValue({ user: { id: "authorized-owner" } });
    expect((await POST(request({ action: "create", bytes: 100, clientKey: "one" }, "https://untrusted.invalid"), context)).status).toBe(403);
    expect(mocks.asset).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects image payloads and invalid metadata, while accepting large byte counts as metadata", async () => {
    expect((await POST(request({ image: "a".repeat(5000) }), context)).status).toBe(413);
    expect((await POST(request({ action: "create", bytes: -1, clientKey: "one" }), context)).status).toBe(400);
    mocks.create.mockResolvedValue({ id: "one", url: "https://private.invalid/put" });
    expect((await POST(request({ action: "create", bytes: 5_000_000, clientKey: "one" }), context)).status).toBe(200);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith("authorized-trade", "authorized-owner", "one", 5_000_000);
  });
  it("scopes signed access to the trade and owner, selecting originals or thumbnails explicitly", async () => {
    mocks.asset.mockResolvedValue({ objectKey: "original", thumbnailKey: "thumbnail", bytes: 5000, thumbnailBytes: 100, width: 20, height: 10 });
    const response = await GET(new NextRequest("https://journal.invalid/api?asset=one&variant=thumbnail"), context);
    expect(mocks.asset).toHaveBeenCalledWith({ where: { id: "one", tradeId: "authorized-trade", ownerId: "authorized-owner", state: "ready" } });
    expect(mocks.sign).toHaveBeenCalledWith("thumbnail", false); expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ bytes: 100, width: 20, height: 10 });
    mocks.asset.mockResolvedValue(null); expect((await GET(new NextRequest("https://journal.invalid/api?asset=missing"), context)).status).toBe(404);
  });
  it("binds status, finalization and cancellation to the authenticated owner", async () => {
    mocks.status.mockResolvedValue({ state: "pending" }); mocks.finalize.mockResolvedValue({ id: "asset" });
    await GET(new NextRequest("https://journal.invalid/api?upload=one"), context);
    await POST(request({ action: "finalize", id: "one" }), context); await POST(request({ action: "cancel", id: "one" }), context);
    for (const fn of [mocks.status, mocks.finalize, mocks.cancel]) expect(fn).toHaveBeenCalledWith("one", "authorized-trade", "authorized-owner");
  });
});
