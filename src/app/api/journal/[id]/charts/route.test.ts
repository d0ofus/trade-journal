import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chartCreate: vi.fn(),
  chartUpdate: vi.fn(),
  entryFindUnique: vi.fn(),
  entryUpdateMany: vi.fn(),
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
      update: mocks.chartUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/server/journal-storage", () => ({
  storeJournalScreenshot: mocks.storeJournalScreenshot,
}));

function chartRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/journal/entry-1/charts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validChartCreate(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "DEMOA",
    timeframe: "5min",
    purpose: "REVIEW",
    caption: "Created review chart",
    expectedUpdatedAt: "2026-06-26T00:00:00.000Z",
    markers: [
      {
        markerType: "IDEAL_ENTRY",
        time: "2026-06-17T13:35:00.000Z",
        price: 101.2,
        label: "entry marker",
      },
    ],
    ...overrides,
  };
}

function savedChart(overrides: Record<string, unknown> = {}) {
  return {
    id: "chart-1",
    journalEntryId: "entry-1",
    symbol: "DEMOA",
    timeframe: "5M",
    purpose: "REVIEW",
    compareSymbol: null,
    rangeStart: null,
    rangeEnd: null,
    tradingViewLayoutJson: null,
    screenshotKey: null,
    screenshotUrl: null,
    caption: "Created review chart",
    width: null,
    height: null,
    mimeType: null,
    createdAt: new Date("2026-06-26T00:00:00.000Z"),
    updatedAt: new Date("2026-06-26T00:01:00.000Z"),
    markers: [],
    ...overrides,
  };
}

function transactionClient() {
  return {
    journalEntry: {
      findUnique: mocks.entryFindUnique,
      updateMany: mocks.entryUpdateMany,
    },
    journalChart: {
      create: mocks.chartCreate,
    },
  };
}

describe("journal chart create route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.entryUpdateMany.mockResolvedValue({ count: 1 });
    mocks.entryFindUnique.mockResolvedValue({ updatedAt: new Date("2026-06-26T00:10:00.000Z") });
    mocks.chartCreate.mockResolvedValue(savedChart());
    mocks.chartUpdate.mockResolvedValue(savedChart({
      screenshotKey: "journal/entry-1/chart-1.png",
      screenshotUrl: "/api/screenshots/journal/entry-1/chart-1.png",
      width: 1280,
      height: 720,
      mimeType: "image/png",
    }));
    mocks.storeJournalScreenshot.mockResolvedValue({
      key: "journal/entry-1/chart-1.png",
      url: "/api/screenshots/journal/entry-1/chart-1.png",
      width: 1280,
      height: 720,
      mimeType: "image/png",
    });
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  });

  it("requires expectedUpdatedAt before creating a chart", async () => {
    const { POST } = await import("./route");

    const response = await POST(chartRequest(validChartCreate({ expectedUpdatedAt: undefined })), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "expectedUpdatedAt is required for journal chart uploads." });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.storeJournalScreenshot).not.toHaveBeenCalled();
  });

  it("does not create chart rows or store screenshots when the parent entry claim is stale", async () => {
    mocks.entryUpdateMany.mockResolvedValue({ count: 0 });
    const { POST } = await import("./route");

    const response = await POST(chartRequest(validChartCreate({
      screenshotDataUrl: "data:image/png;base64,AAAA",
      width: 1280,
      height: 720,
      mimeType: "image/png",
    })), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "Journal entry changed in another tab. Refresh before saving again.",
      currentUpdatedAt: "2026-06-26T00:10:00.000Z",
    });
    expect(mocks.chartCreate).not.toHaveBeenCalled();
    expect(mocks.chartUpdate).not.toHaveBeenCalled();
    expect(mocks.storeJournalScreenshot).not.toHaveBeenCalled();
  });

  it("claims the parent entry version, creates the chart, and returns the next entry token", async () => {
    const { POST } = await import("./route");

    const response = await POST(chartRequest(validChartCreate()), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.entryUpdateMany).toHaveBeenCalledWith({
      where: { id: "entry-1", updatedAt: new Date("2026-06-26T00:00:00.000Z") },
      data: { updatedAt: expect.any(Date) },
    });
    expect(mocks.chartCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        journalEntryId: "entry-1",
        symbol: "DEMOA",
        caption: "Created review chart",
      }),
      include: { markers: true },
    }));
    expect(body.chart.id).toBe("chart-1");
    expect(typeof body.entryUpdatedAt).toBe("string");
    expect(new Date(body.entryUpdatedAt).getTime()).toBeGreaterThan(new Date("2026-06-26T00:00:00.000Z").getTime());
  });
});
