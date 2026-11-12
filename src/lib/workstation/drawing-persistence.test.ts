import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { emptyDocument, type TradeDocument, type Drawing } from "./types";
import { GET, PATCH } from "@/app/api/closed-trades/[groupKey]/workstation/route";

// Exercise the real HTTP parser and response with in-memory persistence; no DB or auth service.
const state = vi.hoisted(() => ({ document: null as TradeDocument | null, saves: 0 }));
vi.mock("@/lib/prisma", () => ({ prisma: { closedTrade: { findUnique: async () => ({ account: { ibkrAccount: "INDEX-DRAWING-TEST" } }) } } }));
vi.mock("@/lib/server/api-auth", () => ({ requireApiSession: async () => null }));
vi.mock("@/lib/server/e2e-demo-write-guard", () => ({ rejectE2eNonDemoClosedTrade: () => null }));
vi.mock("@/lib/server/trade-workstation", () => ({
  WorkstationError: class extends Error { status = 500; },
  readWorkstationDocument: async () => state.document,
  saveWorkstationDocument: async (_key: string, doc: TradeDocument, revision: number) => { state.saves++; state.document = structuredClone({ ...doc, revision: revision + 1 }); return state.document; },
}));
const params = { params: Promise.resolve({ groupKey: "index-drawing-test" }) };
const request = (document: TradeDocument) => new NextRequest("http://localhost/api/closed-trades/index-drawing-test/workstation", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, expectedRevision: document.revision }) });
beforeEach(() => { vi.stubEnv("TRADES_WORKSTATION_ENABLED", "1"); state.document = emptyDocument(); state.saves = 0; });
afterEach(() => vi.unstubAllEnvs());

it("retains index identity, raw anchors, panel scope and style through PATCH and GET", async () => {
  const stock: Drawing = { id: "stock", tool: "horizontal", points: [{ time: 100, price: 50 }], text: "Stock level", color: "#123456", width: 1.5, dashed: false, panel: "chart-1", hidden: false, locked: false, createdAt: 100 };
  const index: Drawing = { ...stock, id: "index", target: { kind: "benchmark", symbol: "QQQ" }, tool: "text", text: "Index note", points: [{ time: 100, price: 450 }, { time: 200, price: 452 }], noteWidth: 240, panel: null, locked: true, dashed: true };
  const doc = { ...emptyDocument(), drawings: [stock, index] };
  expect((await PATCH(request(doc), params)).status).toBe(200);
  const response = await GET(new NextRequest("http://localhost/api/closed-trades/index-drawing-test/workstation"), params);
  expect(response.status).toBe(200);
  expect((await response.json()).drawings).toEqual(doc.drawings);
  expect(state.saves).toBe(1);
});
it("rejects unsupported targeted tools before persistence", async () => {
  const doc = { ...emptyDocument(), drawings: [{ id: "invalid", tool: "trend", points: [{ time: 100, price: 450 }, { time: 200, price: 460 }], target: { kind: "benchmark", symbol: "SPY" }, text: "", color: "#123456", width: 1, dashed: false, panel: null, hidden: false, locked: false, createdAt: 100 }] } as TradeDocument;
  expect((await PATCH(request(doc), params)).status).toBe(400);
  expect(state.saves).toBe(0);
});
it("retains per-group peer frame dimensions through HTTP save/load and rejects invalid sizes", async () => {
  const comparison = { drawings: {}, arrangements: { group: { order: ["PEER"], hidden: ["PEER"], sizes: { PRIMARY: { width: 900, height: 600 }, PEER: { width: 480, height: 328 } } } } };
  const doc = { ...emptyDocument(), comparison };
  expect((await PATCH(request(doc), params)).status).toBe(200);
  expect((await (await GET(new NextRequest("http://localhost/api/closed-trades/index-drawing-test/workstation"), params)).json()).comparison).toEqual(comparison);
  doc.comparison.arrangements.group.sizes.PEER.width = 0;
  expect((await PATCH(request(doc), params)).status).toBe(400);
  expect(state.saves).toBe(1);
});
