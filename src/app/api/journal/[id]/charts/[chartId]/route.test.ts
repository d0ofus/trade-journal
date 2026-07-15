import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  chartFindFirst: vi.fn(),
  chartFindUniqueOrThrow: vi.fn(),
  chartMarkerCreateMany: vi.fn(),
  chartMarkerDeleteMany: vi.fn(),
  chartUpdateMany: vi.fn(),
  getServerSession: vi.fn(),
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
      delete: vi.fn(),
      findFirst: mocks.chartFindFirst,
    },
    $transaction: mocks.transaction,
  },
}));

function chartRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/journal/entry-1/charts/chart-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validChartPatch(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "DEMOA",
    timeframe: "5min",
    purpose: "REVIEW",
    caption: "Updated chart review",
    expectedUpdatedAt: "2026-06-26T00:00:00.000Z",
    markers: [
      {
        markerType: "IDEAL_ENTRY",
        time: "2026-06-17T13:35:00.000Z",
        price: 101.2,
        label: "stale entry marker",
      },
    ],
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
    journalChartMarker: {
      createMany: mocks.chartMarkerCreateMany,
      deleteMany: mocks.chartMarkerDeleteMany,
    },
  };
}

describe("journal chart route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { email: "demo@example.test" } });
    mocks.chartFindFirst.mockResolvedValue({ updatedAt: new Date("2026-06-26T00:10:00.000Z") });
    mocks.chartUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chartFindUniqueOrThrow.mockResolvedValue({
      id: "chart-1",
      journalEntryId: "entry-1",
      symbol: "DEMOA",
      timeframe: "5M",
      rangeStart: null,
      rangeEnd: null,
      tradingViewLayoutJson: null,
      screenshotKey: null,
      screenshotUrl: null,
      caption: "Updated chart review",
      width: null,
      height: null,
      mimeType: null,
      purpose: "REVIEW",
      compareSymbol: null,
      createdAt: new Date("2026-06-26T00:00:00.000Z"),
      updatedAt: new Date("2026-06-26T00:11:00.000Z"),
      markers: [],
    });
    mocks.transaction.mockImplementation(async (callback) => callback(transactionClient()));
  });

  it("requires expectedUpdatedAt before mutating a chart", async () => {
    const { PATCH } = await import("./route");

    const response = await PATCH(chartRequest(validChartPatch({ expectedUpdatedAt: undefined })), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "expectedUpdatedAt is required for chart updates." });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not replace markers when a stale chart save loses the version claim", async () => {
    mocks.chartUpdateMany.mockResolvedValue({ count: 0 });
    const { PATCH } = await import("./route");

    const response = await PATCH(chartRequest(validChartPatch()), {
      params: Promise.resolve({ id: "entry-1", chartId: "chart-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "Journal chart changed in another tab. Refresh before saving again.",
      currentUpdatedAt: "2026-06-26T00:10:00.000Z",
    });
    expect(mocks.chartMarkerDeleteMany).not.toHaveBeenCalled();
    expect(mocks.chartMarkerCreateMany).not.toHaveBeenCalled();
  });
});
