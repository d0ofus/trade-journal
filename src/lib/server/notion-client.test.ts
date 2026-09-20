import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { notionChildren, notionRequest } from "./notion-client";
beforeEach(async () => { vi.stubEnv("NOTION_TOKEN", "mocked-local-connection"); vi.stubEnv("NOTION_PUBLISH_ENABLED", "1"); vi.stubEnv("E2E_DEMO_ONLY_WRITES", "0"); await prisma.notionRequestGate.deleteMany(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Notion transport safety", () => {
  it("paginates children and does not silently truncate after the first page", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ results: [{ id: "first" }], has_more: true, next_cursor: "next" })).mockResolvedValueOnce(Response.json({ results: [{ id: "second" }], has_more: false })); vi.stubGlobal("fetch", fetch);
    expect(await notionChildren("test-block")).toEqual([{ id: "first" }, { id: "second" }]); expect(fetch.mock.calls[1][0]).toContain("start_cursor=next");
  });
  it("records and respects Retry-After without blindly repeating a write", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "30" } })); vi.stubGlobal("fetch", fetch);
    await expect(notionRequest("/pages", "POST", {})).rejects.toMatchObject({ status: 429, uncertain: false });
    const gate = await prisma.notionRequestGate.findUniqueOrThrow({ where: { key: "notion" } });
    expect(gate.nextAt.getTime() - Date.now()).toBeGreaterThan(29_000);
    await expect(notionRequest("/users/me")).rejects.toMatchObject({ status: 429 }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("marks an unconfirmed write as uncertain and never automatically retries it", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("socket lost")); vi.stubGlobal("fetch", fetch);
    await expect(notionRequest("/pages", "POST", {})).rejects.toMatchObject({ uncertain: true }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects writes in browser-test mode and while disabled", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); vi.stubEnv("NOTION_PUBLISH_ENABLED", "0");
    await expect(notionRequest("/pages", "POST", {})).rejects.toThrow(/disabled/);
    vi.stubEnv("NOTION_PUBLISH_ENABLED", "1"); vi.stubEnv("E2E_DEMO_ONLY_WRITES", "1");
    await expect(notionRequest("/pages", "POST", {})).rejects.toThrow(/test mode/); expect(fetch).not.toHaveBeenCalled();
  });
});
