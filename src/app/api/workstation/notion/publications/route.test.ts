import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";
const mocks = vi.hoisted(() => ({ session: true, preview: vi.fn(), start: vi.fn(), resume: vi.fn(), publication: vi.fn(), job: vi.fn() }));
vi.mock("next-auth", () => ({ getServerSession: async () => mocks.session ? { user: { name: "test" } } : null }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { notionPublication: { findUnique: mocks.publication }, notionPublishJob: { findFirst: mocks.job, findUnique: mocks.job } } }));
vi.mock("@/lib/server/notion-publication-plan", () => ({ createNotionPreview: mocks.preview, publicationStatus: (job: unknown) => job }));
vi.mock("@/lib/server/notion-publisher", () => ({ startNotionPublication: mocks.start, resumeNotionPublication: mocks.resume }));
function request(body?: unknown, origin = "http://localhost") { return new NextRequest("http://localhost/api/workstation/notion/publications?groupKey=test-trade", body ? { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}); }
beforeEach(() => { mocks.session = true; mocks.preview.mockReset(); mocks.start.mockReset(); mocks.resume.mockReset(); mocks.publication.mockResolvedValue(null); mocks.job.mockResolvedValue(null); vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); vi.stubEnv("NOTION_PUBLISH_ENABLED", "0"); });
afterEach(() => vi.unstubAllEnvs());
describe("Notion publication API boundaries", () => {
  it("requires a session for reads and writes", async () => {
    mocks.session = false;
    expect((await GET(request())).status).toBe(401);
    expect((await POST(request({ action: "preview", groupKey: "test-trade", revision: 1 }))).status).toBe(401);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations", async () => {
    expect((await POST(request({ action: "preview", groupKey: "test-trade", revision: 1 }, "https://other.invalid"))).status).toBe(403);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("does not run jobs during GET status polling", async () => {
    expect((await GET(request())).status).toBe(200); expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
  it("accepts only saved-review identifiers, not a destination override or document", async () => {
    expect((await POST(request({ action: "preview", groupKey: "test-trade", revision: 1, pageId: "manual-page" }))).status).toBe(400);
    expect((await POST(request({ action: "preview", groupKey: "test-trade", revision: 1, document: {} }))).status).toBe(400);
    mocks.preview.mockResolvedValue({ id: "preview-job" });
    expect((await POST(request({ action: "preview", groupKey: "test-trade", revision: 1 }))).status).toBe(200);
    expect(mocks.preview).toHaveBeenCalledWith("test-trade", 1, "http://localhost");
  });
});
