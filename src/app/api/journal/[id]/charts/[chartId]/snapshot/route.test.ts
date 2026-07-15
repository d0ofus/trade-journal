import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chartFindFirst: vi.fn(),
  chartFindUniqueOrThrow: vi.fn(),
  chartUpdateMany: vi.fn(),
  getServerSession: vi.fn(),
  storeJournalScreenshot: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    journalChart: {
      findFirst: mocks.chartFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/journal-storage", () => ({
  storeJournalScreenshot: mocks.storeJournalScreenshot,
}));

function snapshotRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/journal/entry-1/charts/chart-1/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    screenshotDataUrl: "data:image/png;base64,AAAA",
    width: 1280,
    height: 720,
    mimeType: "image/png",
    tradingViewLayoutJson: "{\"range\":\"demo\"}",
    expectedUpdatedAt: "2026-06-26T00:00:00.000Z",
    ...overrides,
  };
}

function transactionClient() {
  return {
    journalChart: {
      findFirst: mocks.chartFindFirst,
      findUniqueOrThrow: mocks.chartFindUniqueOrThrow,
      updateMany: mocks.chartUpdateMany,
    },
  };
}

describe("journal chart snapshot route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.chartFindFirst.mockResolvedValue({
      id: "chart-1",
      updatedAt: new Date("2026-06-26T00:00:00.000Z"),
    });
    mocks.storeJournalScreenshot.mockResolvedValue({
      key: "journal/entry-1/chart-1.png",
      url: "/api/screenshots/journal/entry-1/chart-1.png",
      width: 1280,
      height: 720,
      mimeType: "image/png",
    });
    mocks.chartUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
    mocks.chartFindUniqueOrThrow.mockResolvedValue({
      id: "chart-1",
      journalEntryId: "entry-1",
      symbol: "DEMOA",
      timeframe: "5M",
      purpose: "REVIEW",
      compareSymbol: null,
      rangeStart: null,
      rangeEnd: null,
      tradingViewLayoutJson: "{\"range\":\"demo\"}",
      screenshotKey: "journal/entry-1/chart-1.png",
      screenshotUrl: "/api/screenshots/journal/entry-1/chart-1.png",
      caption: "Review chart",
      width: 1280,
      height: 720,
      mimeType: "image/png",
      createdAt: new Date("2026-06-26T00:00:00.000Z"),
      updatedAt: new Date("2026-06-26T00:01:00.000Z"),
      markers: [],
    });
  });

  it("requires expectedUpdatedAt before storing a snapshot", async () => {
    const { POST } = await import("./route");

    const response = await POST(snapshotRequest(validSnapshot({ expectedUpdatedAt: undefined })), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "expectedUpdatedAt is required for chart snapshots." });
    expect(mocks.storeJournalScreenshot).not.toHaveBeenCalled();
    expect(mocks.chartUpdateMany).not.toHaveBeenCalled();
  });

  it("does not store a screenshot when the snapshot version is already stale", async () => {
    mocks.chartFindFirst.mockResolvedValue({
      id: "chart-1",
      updatedAt: new Date("2026-06-26T00:10:00.000Z"),
    });
    const { POST } = await import("./route");

    const response = await POST(snapshotRequest(validSnapshot()), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "Journal chart changed in another tab. Refresh before saving again.",
      currentUpdatedAt: "2026-06-26T00:10:00.000Z",
    });
    expect(mocks.storeJournalScreenshot).not.toHaveBeenCalled();
    expect(mocks.chartUpdateMany).not.toHaveBeenCalled();
  });

  it("updates the snapshot with a chart version claim", async () => {
    const { POST } = await import("./route");

    const response = await POST(snapshotRequest(validSnapshot()), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.storeJournalScreenshot).toHaveBeenCalledWith({
      journalEntryId: "entry-1",
      chartId: "chart-1",
      dataUrl: "data:image/png;base64,AAAA",
      width: 1280,
      height: 720,
    });
    expect(mocks.chartUpdateMany).toHaveBeenCalledWith({
      where: {
        id: "chart-1",
        journalEntryId: "entry-1",
        updatedAt: new Date("2026-06-26T00:00:00.000Z"),
      },
      data: {
        screenshotKey: "journal/entry-1/chart-1.png",
        screenshotUrl: "/api/screenshots/journal/entry-1/chart-1.png",
        width: 1280,
        height: 720,
        mimeType: "image/png",
        tradingViewLayoutJson: "{\"range\":\"demo\"}",
      },
    });
    expect(body.chart.updatedAt).toBe("2026-06-26T00:01:00.000Z");
    expect(body.chart.width).toBe(1280);
  });

  it("does not return a saved chart when the version claim is lost after storage", async () => {
    mocks.chartUpdateMany.mockResolvedValue({ count: 0 });
    mocks.chartFindFirst
      .mockResolvedValueOnce({
        id: "chart-1",
        updatedAt: new Date("2026-06-26T00:00:00.000Z"),
      })
      .mockResolvedValueOnce({
        updatedAt: new Date("2026-06-26T00:11:00.000Z"),
      });
    const { POST } = await import("./route");

    const response = await POST(snapshotRequest(validSnapshot()), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "Journal chart changed in another tab. Refresh before saving again.",
      currentUpdatedAt: "2026-06-26T00:11:00.000Z",
    });
    expect(mocks.storeJournalScreenshot).toHaveBeenCalledTimes(1);
    expect(mocks.chartFindUniqueOrThrow).not.toHaveBeenCalled();
  });
});
