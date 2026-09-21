import { describe, expect, it } from "vitest";
import { emptyNotionReview, executedTradeReviewDefaults, notionReviewSchema } from "./notion-template";
import { demoTrades, initialDemoDocument, createDemoAdapter, DEMO_PREFIX } from "./demo";
import { notionJournalPatch, readNotionReview } from "../server/notion-review-storage";

describe("executed-trade review defaults", () => {
  it("defaults new/legacy empty reviews without mutating their original values", () => {
    const old = emptyNotionReview(); old.properties.typeOfReview = [];
    expect(executedTradeReviewDefaults(old)).toMatchObject({ executedTradeDefaults: 1, properties: { typeOfReview: ["Taken Trade"] } });
    expect(old.properties.typeOfReview).toEqual([]); expect(old.executedTradeDefaults).toBeUndefined();
    expect(emptyNotionReview().properties.typeOfReview).toBeUndefined();
  });
  it("preserves existing choices and intentional clearing through JSON and storage mapping", () => {
    const original = emptyNotionReview(); original.properties.typeOfReview = ["Sector Thematic"];
    const initialized = executedTradeReviewDefaults(original);
    expect(initialized.properties.typeOfReview).toEqual(["Sector Thematic"]);
    initialized.properties.typeOfReview = [];
    const restored = notionReviewSchema.parse(JSON.parse(JSON.stringify(initialized)));
    const patch = notionJournalPatch(restored);
    const read = readNotionReview({ templateData: patch.templateData, notionRelations: [] });
    expect(executedTradeReviewDefaults(read).properties.typeOfReview).toEqual([]);
  });
  it("initializes every demo trade and retains deliberate clearing on reload", async () => {
    for (const trade of demoTrades) expect(initialDemoDocument(trade).review.notion?.properties.typeOfReview).toEqual(["Taken Trade"]);
    const storage = new Map<string, string>();
    const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
    try {
      const adapter = createDemoAdapter(), trade = demoTrades[0], old = initialDemoDocument(trade);
      delete old.review.notion!.executedTradeDefaults; old.review.notion!.properties.typeOfReview = [];
      storage.set(DEMO_PREFIX + trade.id, JSON.stringify(old));
      const loaded = await adapter.load(trade.id); expect(loaded.review.notion!.properties.typeOfReview).toEqual(["Taken Trade"]);
      loaded.review.notion!.properties.typeOfReview = [];
      await adapter.save(trade.id, loaded, loaded.revision);
      expect((await adapter.load(trade.id)).review.notion!.properties.typeOfReview).toEqual([]);
    } finally { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); }
  });
});
