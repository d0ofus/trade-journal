/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const DEMO_ACCOUNT_ID = "demo-account-workstation";
const DEMO_ACCOUNT_CODE = "DEMO-WORKSTATION";
const DEMO_SOURCE = "demo";
const DEMO_SYMBOLS = ["DEMOA", "DEMOB", "DEMOC"];
const DEMO_JOURNAL_ENTRY_IDS = ["demo-journal-a", "demo-journal-b"];
const DEMO_TAG_NAMES = ["demo-momentum", "demo-good-scaleout", "demo-late-entry"];

function toDate(value) {
  return new Date(value);
}

function utcDay(value) {
  return toDate(`${value}T00:00:00.000Z`);
}

function candleRowsAtTimes(symbol, timeframe, times, startPrice, trend) {
  const rows = [];
  let previousClose = startPrice;

  for (let index = 0; index < times.length; index += 1) {
    const wave = Math.sin(index / 3) * 0.45;
    const drift = trend * index;
    const open = previousClose;
    const close = startPrice + drift + wave;
    const high = Math.max(open, close) + 0.75;
    const low = Math.min(open, close) - 0.75;
    previousClose = close;
    rows.push({
      id: `demo-candle-${symbol}-${timeframe}-${index}`,
      symbol,
      timeframe,
      source: DEMO_SOURCE,
      time: new Date(times[index] * 1000),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 50000 + index * 137,
    });
  }

  return rows;
}

function sessionCandleRows(expectedBarStarts, symbol, timeframe, fromIso, toIso, startPrice, trend) {
  const times = expectedBarStarts({
    timeframe,
    from: Math.floor(toDate(fromIso).getTime() / 1000),
    to: Math.floor(toDate(toIso).getTime() / 1000),
  });
  return candleRowsAtTimes(symbol, timeframe, times, startPrice, trend);
}

function sessionDailyCandleRows(expectedBarStarts, symbol, fromIso, toIso, startPrice, trend) {
  const hourly = expectedBarStarts({
    timeframe: "1h",
    from: Math.floor(toDate(fromIso).getTime() / 1000),
    to: Math.floor(toDate(toIso).getTime() / 1000),
  });
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dates = new Set(hourly.map((time) => {
    const parts = new Map(formatter.formatToParts(new Date(time * 1000)).map((part) => [part.type, part.value]));
    return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  }));
  const times = [...dates].map((date) => Math.floor(toDate(`${date}T00:00:00.000Z`).getTime() / 1000));
  return candleRowsAtTimes(symbol, "1d", times, startPrice, trend);
}

function mergeCandleOverrides(rows, overrides) {
  const byKey = new Map(rows.map((row) => [`${row.symbol}:${row.timeframe}:${row.time.toISOString()}`, row]));

  for (const override of overrides) {
    const time = toDate(override.time);
    const key = `${override.symbol}:${override.timeframe}:${time.toISOString()}`;
    const existing = byKey.get(key);
    const values = {
      open: override.open,
      high: override.high,
      low: override.low,
      close: override.close,
      volume: override.volume,
    };

    if (existing) {
      Object.assign(existing, values);
      continue;
    }

    rows.push({
      id: `demo-candle-${override.symbol}-${override.timeframe}-${override.id}`,
      symbol: override.symbol,
      timeframe: override.timeframe,
      source: DEMO_SOURCE,
      time,
      ...values,
    });
  }

  return rows;
}

async function refreshCanonicalMaterializations(accountId) {
  const [{ prisma: appPrisma }, { refreshMaterializedExecutionAnalytics }, { refreshMaterializedClosedTrades }] = await Promise.all([
    import("../src/lib/prisma.ts"),
    import("../src/lib/server/execution-analytics-materialized.ts"),
    import("../src/lib/server/closed-trades-materialized.ts"),
  ]);

  try {
    await refreshMaterializedExecutionAnalytics();
    await refreshMaterializedClosedTrades({ accountIds: [accountId] });
  } finally {
    await appPrisma.$disconnect();
  }
}

function assertNearlyEqual(label, actual, expected) {
  if (Math.abs(actual - expected) > 0.000001) {
    throw new Error(`Demo seed materialization mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
}

function assertMaterializedTrade(trade, expected) {
  if (!trade) {
    throw new Error(`Demo seed expected a materialized closed trade for ${expected.symbol}`);
  }
  if (trade.direction !== expected.direction) {
    throw new Error(
      `Demo seed materialization mismatch for ${expected.symbol} direction: expected ${expected.direction}, got ${trade.direction}`,
    );
  }

  assertNearlyEqual(`${expected.symbol} totalQuantity`, trade.totalQuantity, expected.totalQuantity);
  assertNearlyEqual(`${expected.symbol} avgEntryPrice`, trade.avgEntryPrice, expected.avgEntryPrice);
  assertNearlyEqual(`${expected.symbol} avgExitPrice`, trade.avgExitPrice, expected.avgExitPrice);
  assertNearlyEqual(`${expected.symbol} grossRealizedPnl`, trade.grossRealizedPnl, expected.grossRealizedPnl);
  assertNearlyEqual(`${expected.symbol} realizedPnl`, trade.realizedPnl, expected.realizedPnl);
  assertNearlyEqual(`${expected.symbol} totalCommission`, trade.totalCommission, expected.totalCommission);

  const executionIds = trade.executions.map((execution) => execution.executionId);
  if (executionIds.join("|") !== expected.executionIds.join("|")) {
    throw new Error(
      `Demo seed materialization mismatch for ${expected.symbol} executions: expected ${expected.executionIds.join(", ")}, got ${executionIds.join(", ")}`,
    );
  }
}

async function authorizeDemoSeed() {
  const { authorizeDemoSeedEnvironment } = await import("../src/lib/demo-seed-safety.ts");
  const { loadDotEnvWithoutOverride } = await import("../src/lib/test-database-safety.ts");
  loadDotEnvWithoutOverride();
  return authorizeDemoSeedEnvironment(process.env);
}

async function collectDemoCleanupTargets() {
  const closedTrades = await prisma.closedTrade.findMany({
    where: { accountId: DEMO_ACCOUNT_ID },
    select: { groupKey: true },
  });
  const closedTradeGroupKeys = closedTrades.map((trade) => trade.groupKey);
  const linkedJournals = closedTradeGroupKeys.length > 0
    ? await prisma.journalLink.findMany({
        where: {
          linkType: "REVIEW_SOURCE",
          targetType: "CLOSED_TRADE",
          targetId: { in: closedTradeGroupKeys },
        },
        select: { journalEntryId: true },
      })
    : [];
  const journalEntryIds = [
    ...new Set([...DEMO_JOURNAL_ENTRY_IDS, ...linkedJournals.map((link) => link.journalEntryId)]),
  ];

  const [
    journalTags,
    closedTradeTags,
    executionTags,
    dayNoteTags,
    symbolNoteTags,
    namedDemoTags,
    journalRelationTags,
    namedDemoRelationTags,
  ] = await Promise.all([
    prisma.journalEntryTag.findMany({
      where: { journalEntryId: { in: journalEntryIds } },
      select: { tagId: true },
    }),
    prisma.closedTradeTag.findMany({
      where: { closedTradeGroupKey: { in: closedTradeGroupKeys } },
      select: { tagId: true },
    }),
    prisma.executionTag.findMany({
      where: { execution: { accountId: DEMO_ACCOUNT_ID } },
      select: { tagId: true },
    }),
    prisma.dayNoteTag.findMany({
      where: { dayNote: { accountId: DEMO_ACCOUNT_ID } },
      select: { tagId: true },
    }),
    prisma.symbolNoteTag.findMany({
      where: { symbolNote: { accountId: DEMO_ACCOUNT_ID } },
      select: { tagId: true },
    }),
    prisma.tag.findMany({
      where: { name: { in: DEMO_TAG_NAMES } },
      select: { id: true },
    }),
    prisma.journalEntryNotionRelation.findMany({
      where: { journalEntryId: { in: journalEntryIds } },
      select: { relationTagId: true },
    }),
    prisma.journalNotionRelationTag.findMany({
      where: {
        OR: [
          { kind: "ACCOUNT", normalizedName: "demo-workstation" },
          { kind: "TYPE_OF_REVIEW", normalizedName: "closed-trade-review" },
        ],
      },
      select: { id: true },
    }),
  ]);

  return {
    closedTradeGroupKeys,
    journalEntryIds,
    relationTagIds: [
      ...new Set([
        ...journalRelationTags.map((row) => row.relationTagId),
        ...namedDemoRelationTags.map((row) => row.id),
      ]),
    ],
    tagIds: [
      ...new Set([
        ...journalTags.map((row) => row.tagId),
        ...closedTradeTags.map((row) => row.tagId),
        ...executionTags.map((row) => row.tagId),
        ...dayNoteTags.map((row) => row.tagId),
        ...symbolNoteTags.map((row) => row.tagId),
        ...namedDemoTags.map((row) => row.id),
      ]),
    ],
  };
}

async function pruneUnreferencedDemoTags(tagIds, relationTagIds) {
  if (tagIds.length > 0) {
    await prisma.tag.deleteMany({
      where: {
        id: { in: tagIds },
        executionTags: { none: {} },
        dayNoteTags: { none: {} },
        symbolNoteTags: { none: {} },
        journalEntryTags: { none: {} },
        closedTradeTags: { none: {} },
      },
    });
  }

  if (relationTagIds.length > 0) {
    await prisma.journalNotionRelationTag.deleteMany({
      where: {
        id: { in: relationTagIds },
        entries: { none: {} },
      },
    });
  }
}

async function resetDemoRows({ clearBackupAudits }) {
  const cleanupTargets = await collectDemoCleanupTargets();

  if (clearBackupAudits) {
    await prisma.backupAudit.deleteMany();
  }

  await prisma.journalReviewAction.deleteMany({ where: { id: { in: ["demo-review-action-a", "demo-review-action-b"] } } });
  await prisma.journalReview.deleteMany({ where: { id: "demo-weekly-review" } });
  await prisma.journalPlaybookExample.deleteMany({ where: { id: "demo-playbook-example-a" } });
  await prisma.journalEntry.deleteMany({ where: { id: { in: cleanupTargets.journalEntryIds } } });
  await prisma.journalPlaybook.deleteMany({ where: { id: "demo-playbook-opening-drive" } });
  await prisma.journalSavedView.deleteMany({ where: { id: "demo-saved-view" } });
  await prisma.dayNote.deleteMany({ where: { id: "demo-day-note" } });
  await prisma.closedTradeNote.deleteMany({ where: { groupKey: { contains: DEMO_ACCOUNT_ID } } });
  await prisma.marketCandle.deleteMany({ where: { id: { startsWith: "demo-candle-" } } });
  await prisma.importBatch.deleteMany({ where: { id: { startsWith: "demo-import-" } } });
  await prisma.account.deleteMany({ where: { id: DEMO_ACCOUNT_ID } });
  await prisma.instrument.deleteMany({ where: { id: { in: ["demo-inst-a", "demo-inst-b", "demo-inst-c"] } } });
  await pruneUnreferencedDemoTags(cleanupTargets.tagIds, cleanupTargets.relationTagIds);
}

async function seedDemo(safety) {
  await resetDemoRows(safety);
  const { expectedUsEquitiesBarStarts } = await import("../src/lib/server/market-session-calendar.ts");

  const account = await prisma.account.create({
    data: {
      id: DEMO_ACCOUNT_ID,
      name: "Demo Workstation Account",
      ibkrAccount: DEMO_ACCOUNT_CODE,
      baseCurrency: "USD",
    },
  });

  const instruments = await Promise.all([
    prisma.instrument.create({
      data: { id: "demo-inst-a", symbol: "DEMOA", exchange: "NASDAQ", assetType: "STOCK", currency: "USD" },
    }),
    prisma.instrument.create({
      data: { id: "demo-inst-b", symbol: "DEMOB", exchange: "NASDAQ", assetType: "STOCK", currency: "USD" },
    }),
    prisma.instrument.create({
      data: { id: "demo-inst-c", symbol: "DEMOC", exchange: "NYSE", assetType: "STOCK", currency: "USD" },
    }),
  ]);
  const bySymbol = new Map(instruments.map((instrument) => [instrument.symbol, instrument]));

  const executions = [
    {
      id: "demo-exec-a-entry",
      symbol: "DEMOA",
      executedAt: "2026-06-17T13:35:00.000Z",
      side: "BUY",
      quantity: 100,
      price: 101.2,
      commission: 1.1,
      strategy: "opening-drive",
    },
    {
      id: "demo-exec-a-scale",
      symbol: "DEMOA",
      executedAt: "2026-06-17T14:20:00.000Z",
      side: "SELL",
      quantity: 50,
      price: 104.6,
      commission: 0.9,
      strategy: "opening-drive",
    },
    {
      id: "demo-exec-a-exit",
      symbol: "DEMOA",
      executedAt: "2026-06-17T16:45:00.000Z",
      side: "SELL",
      quantity: 50,
      price: 106.25,
      commission: 0.9,
      strategy: "opening-drive",
    },
    {
      id: "demo-exec-b-entry",
      symbol: "DEMOB",
      executedAt: "2026-06-18T13:42:00.000Z",
      side: "BUY",
      quantity: 80,
      price: 62.4,
      commission: 1.05,
      strategy: "failed-breakout",
    },
    {
      id: "demo-exec-b-exit",
      symbol: "DEMOB",
      executedAt: "2026-06-18T15:10:00.000Z",
      side: "SELL",
      quantity: 80,
      price: 60.9,
      commission: 1.05,
      strategy: "failed-breakout",
    },
    {
      id: "demo-exec-c-entry",
      symbol: "DEMOC",
      executedAt: "2026-06-18T12:05:00.000Z",
      side: "SELL",
      quantity: 120,
      price: 44.8,
      commission: 1.2,
      strategy: "trend-short",
    },
    {
      id: "demo-exec-c-cover-1",
      symbol: "DEMOC",
      executedAt: "2026-06-18T16:30:00.000Z",
      side: "BUY",
      quantity: 60,
      price: 42.95,
      commission: 0.95,
      strategy: "trend-short",
    },
    {
      id: "demo-exec-c-cover-2",
      symbol: "DEMOC",
      executedAt: "2026-06-22T13:50:00.000Z",
      side: "BUY",
      quantity: 60,
      price: 41.7,
      commission: 0.95,
      strategy: "trend-short",
    },
  ];
  const rawSeedContent = JSON.stringify(executions, null, 2);
  const rawSeedSha256 = crypto.createHash("sha256").update(rawSeedContent).digest("hex");
  const rawSeedStorageKey = `import-artifacts/sha256/${rawSeedSha256}.txt`;
  const demoImportAccounting = {
    version: 1,
    kind: "executions",
    primary: {
      parserRejected: 0,
      idealFxExcluded: 0,
      unresolvedReference: 0,
      executionInserted: executions.length,
      executionChargeUpdated: 0,
      unchangedDuplicate: 0,
      positionApplied: 0,
      dailySnapshotApplied: 0,
    },
  };

  await prisma.importArtifact.upsert({
    where: { storageKey: rawSeedStorageKey },
    update: {
      rawBytes: Buffer.byteLength(rawSeedContent),
      content: rawSeedContent,
    },
    create: {
      storageKey: rawSeedStorageKey,
      rawSha256: rawSeedSha256,
      rawBytes: Buffer.byteLength(rawSeedContent),
      content: rawSeedContent,
    },
  });

  const importBatch = await prisma.importBatch.create({
    data: {
      id: "demo-import-batch",
      filename: "demo-workstation-seed.json",
      fileType: "demo-seed",
      status: "MATERIALIZED",
      accountId: account.id,
      rowsSeen: executions.length,
      rowsImported: executions.length,
      rowsSkipped: 0,
      rawSha256: rawSeedSha256,
      rawBytes: Buffer.byteLength(rawSeedContent),
      rawStorageKey: rawSeedStorageKey,
      parserVersion: "demo-seed-v1",
      importedAt: toDate("2026-06-26T12:00:00.000Z"),
      cohortId: "demo-import-cohort-main",
      sourceId: "demo-import-source-main",
      sourceFilename: "demo-workstation-seed.json",
      cohortRole: "MEMBER",
      notes: `[import-accounting:v1] ${JSON.stringify(demoImportAccounting)}\nDEMO_WORKSTATION deterministic mock executions for review.`,
    },
  });

  await prisma.importBatch.createMany({
    data: [
      {
        id: "demo-import-flex-trades",
        filename: "demo-flex-statement.csv::trades",
        fileType: "flex-trades",
        status: "MATERIALIZED",
        importedAt: toDate("2026-06-25T12:00:00.000Z"),
        accountId: account.id,
        rowsSeen: 8,
        rowsImported: 8,
        rawSha256: rawSeedSha256,
        rawBytes: Buffer.byteLength(rawSeedContent),
        rawStorageKey: rawSeedStorageKey,
        parserVersion: "demo-phase6-flex-parser-v1",
        cohortId: "demo-import-cohort-flex",
        sourceId: "demo-import-source-flex",
        sourceFilename: "demo-flex-statement.csv",
        sourceSection: "trades",
        cohortRole: "MEMBER",
        notes: "Flex trade section completed.",
      },
      {
        id: "demo-import-flex-positions",
        filename: "demo-flex-statement.csv::positions",
        fileType: "flex-positions",
        status: "MATERIALIZED",
        importedAt: toDate("2026-06-25T12:00:00.000Z"),
        accountId: account.id,
        rowsSeen: 3,
        rowsImported: 3,
        rawSha256: rawSeedSha256,
        rawBytes: Buffer.byteLength(rawSeedContent),
        rawStorageKey: rawSeedStorageKey,
        parserVersion: "demo-phase6-flex-parser-v1",
        positionSnapshotMode: "PARTIAL",
        cohortId: "demo-import-cohort-flex",
        sourceId: "demo-import-source-flex",
        sourceFilename: "demo-flex-statement.csv",
        sourceSection: "positions",
        cohortRole: "MEMBER",
        notes: "Flex position section completed as a partial update.",
      },
      {
        id: "demo-import-failed-direct",
        filename: "demo-failed-positions.csv",
        fileType: "positions",
        status: "FAILED",
        importedAt: toDate("2026-06-24T12:00:00.000Z"),
        rowsSeen: 2,
        rowsSkipped: 2,
        parserVersion: "demo-phase6-parser-with-a-deliberately-long-version-value-for-mobile-wrapping",
        positionSnapshotMode: "FULL",
        cohortId: "demo-import-cohort-failed",
        sourceId: "demo-import-source-failed-positions",
        sourceFilename: "demo-failed-positions.csv",
        cohortRole: "DIRECT_FAILURE",
        errorMessage: "The full snapshot was rejected because its report date was older than the durable account ledger.",
        notes: `${"[import-history:v1:failed]"} cohort=demo-import-cohort-failed; stage=preflight; causes=demo-failed-positions.csv\nDirect validation failure; no rows were applied.`,
      },
      {
        id: "demo-import-failed-rollback",
        filename: "demo-very-long-execution-source-name-for-mobile-history-overflow-verification-2026-06-24.csv",
        fileType: "executions",
        status: "FAILED",
        importedAt: toDate("2026-06-24T12:00:00.000Z"),
        rowsSeen: 5,
        rowsSkipped: 5,
        parserVersion: "demo-phase6-parser-v1",
        cohortId: "demo-import-cohort-failed",
        sourceId: "demo-import-source-failed-executions",
        sourceFilename: "demo-very-long-execution-source-name-for-mobile-history-overflow-verification-2026-06-24.csv",
        cohortRole: "ROLLED_BACK",
        errorMessage: "Rolled back because a sibling import failed. No execution rows were committed.",
        notes: `${"[import-history:v1:rolled-back]"} cohort=demo-import-cohort-failed; stage=preflight; causes=demo-failed-positions.csv\nRolled back because the position source failed.`,
      },
      ...Array.from({ length: 21 }, (_, index) => ({
        id: `demo-import-history-${String(index + 1).padStart(2, "0")}`,
        filename: `demo-history-source-${String(index + 1).padStart(2, "0")}.csv`,
        fileType: "executions",
        status: "MATERIALIZED",
        importedAt: new Date(Date.parse("2026-06-23T12:00:00.000Z") - index * 3_600_000),
        accountId: account.id,
        rowsSeen: index + 1,
        rowsImported: index + 1,
        parserVersion: "demo-phase6-parser-v1",
        cohortId: `demo-import-cohort-history-${String(index + 1).padStart(2, "0")}`,
        sourceId: `demo-import-source-history-${String(index + 1).padStart(2, "0")}`,
        sourceFilename: `demo-history-source-${String(index + 1).padStart(2, "0")}.csv`,
        cohortRole: "MEMBER",
        notes: "Deterministic Phase 6 history record.",
      })),
      {
        id: "demo-import-history-legacy",
        filename: "legacy-import-without-provenance.csv",
        fileType: "executions",
        status: "FAILED",
        importedAt: toDate("2026-06-20T12:00:00.000Z"),
        rowsSeen: 1,
        rowsSkipped: 1,
        errorMessage: "Legacy failure retained without inferred cohort metadata.",
        notes: "Legacy import history record.",
      },
    ],
  });

  await prisma.execution.createMany({
    data: executions.map((execution) => ({
      id: execution.id,
      dedupeKey: execution.id,
      accountId: account.id,
      instrumentId: bySymbol.get(execution.symbol).id,
      importBatchId: importBatch.id,
      executedAt: toDate(execution.executedAt),
      side: execution.side,
      quantity: execution.quantity,
      price: execution.price,
      commission: execution.commission,
      fees: 0,
      currency: "USD",
      orderId: execution.id,
      strategy: execution.strategy,
    })),
  });

  await prisma.position.createMany({
    data: instruments.map((instrument) => ({
      accountId: account.id,
      instrumentId: instrument.id,
      quantity: 0,
      avgCost: 0,
      unrealizedPnl: 0,
      currency: "USD",
    })),
  });

  await prisma.positionSnapshot.createMany({
    data: [
      { accountId: account.id, instrumentId: bySymbol.get("DEMOA").id, date: utcDay("2026-06-16"), quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: "USD" },
      { accountId: account.id, instrumentId: bySymbol.get("DEMOB").id, date: utcDay("2026-06-17"), quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: "USD" },
      { accountId: account.id, instrumentId: bySymbol.get("DEMOC").id, date: utcDay("2026-06-18"), quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: "USD" },
    ],
  });

  await prisma.dailySnapshot.createMany({
    data: [
      { accountId: account.id, date: utcDay("2026-06-16"), equity: 100000, realizedPnl: 0, unrealizedPnl: 0, currency: "USD" },
      { accountId: account.id, date: utcDay("2026-06-17"), equity: 100424, realizedPnl: 424, unrealizedPnl: 0, currency: "USD" },
      { accountId: account.id, date: utcDay("2026-06-18"), equity: 100302, realizedPnl: -122, unrealizedPnl: 0, currency: "USD" },
      { accountId: account.id, date: utcDay("2026-06-22"), equity: 100644, realizedPnl: 342, unrealizedPnl: 0, currency: "USD" },
    ],
  });

  const tradeSpecs = [
    {
      symbol: "DEMOA",
      direction: "LONG",
      openTime: "2026-06-17T13:35:00.000Z",
      closeTime: "2026-06-17T16:45:00.000Z",
      totalQuantity: 100,
      avgEntryPrice: 101.2,
      avgExitPrice: 105.425,
      grossRealizedPnl: 422.5,
      realizedPnl: 419.6,
      totalCommission: 2.9,
      executionIds: ["demo-exec-a-entry", "demo-exec-a-scale", "demo-exec-a-exit"],
      review: {
        content:
          "Setup: opening drive with clean consolidation. Entry: bought first pullback. Exit: scaled into strength and left no runner after volume faded. Lesson: good patience after first push.",
        setup: "Opening drive continuation after the first pullback held above VWAP.",
        thesis: "DEMOA showed relative strength while the index held prior-day highs.",
        entryReview: "Entry was aligned with the reclaim and used the planned pullback level.",
        exitReview: "Scaled into strength and finished the position as volume faded.",
        mistake: "No runner was left for the late-day extension.",
        lesson: "Predefine the runner condition before entering so scale-outs do not consume the whole trade.",
        followUp: "Compare the next five opening-drive trades for scale-out discipline.",
      },
    },
    {
      symbol: "DEMOB",
      direction: "LONG",
      openTime: "2026-06-18T13:42:00.000Z",
      closeTime: "2026-06-18T15:10:00.000Z",
      totalQuantity: 80,
      avgEntryPrice: 62.4,
      avgExitPrice: 60.9,
      grossRealizedPnl: -120,
      realizedPnl: -122.1,
      totalCommission: 2.1,
      executionIds: ["demo-exec-b-entry", "demo-exec-b-exit"],
      review: {
        content:
          "Setup: failed breakout review. Entry was late relative to the trigger. Exit respected the stop, but the trade lacked market confirmation.",
        setup: "Breakout continuation attempt after an early range expansion.",
        thesis: "DEMOB needed broad-market confirmation that never arrived.",
        entryReview: "Entry chased the second push instead of waiting for a clean retest.",
        exitReview: "Stop exit was clean and prevented the trade from becoming a hold-and-hope loss.",
        mistake: "Late entry without market confirmation.",
        lesson: "Require index confirmation before taking second-push breakout entries.",
        followUp: "Add a playbook rule check for market alignment before breakout entries.",
      },
    },
    {
      symbol: "DEMOC",
      direction: "SHORT",
      openTime: "2026-06-18T12:05:00.000Z",
      closeTime: "2026-06-22T13:50:00.000Z",
      totalQuantity: 120,
      avgEntryPrice: 44.8,
      avgExitPrice: 42.325,
      grossRealizedPnl: 297,
      realizedPnl: 293.9,
      totalCommission: 3.1,
      executionIds: ["demo-exec-c-entry", "demo-exec-c-cover-1", "demo-exec-c-cover-2"],
      review: {
        content:
          "Setup: trend short below prior support. Entry: sold breakdown retest. Exit: covered half into first flush and final half after continuation.",
        setup: "Trend short after support failed and price retested from below.",
        thesis: "DEMOC had weak daily context and intraday sellers defended the broken support.",
        entryReview: "Entry was patient and waited for the retest rather than selling the first flush.",
        exitReview: "Covered half into momentum and completed the trade after continuation.",
        mistake: "Position could have been resized larger because risk was well defined.",
        lesson: "Best shorts came from retests with both intraday and daily alignment.",
        followUp: "Tag future retest shorts and compare average hold time.",
      },
    },
  ];

  await refreshCanonicalMaterializations(account.id);

  const materializedTrades = await prisma.closedTrade.findMany({
    where: { accountId: account.id, symbol: { in: DEMO_SYMBOLS }, isStale: false },
    include: { executions: { orderBy: { sortOrder: "asc" }, select: { executionId: true } } },
    orderBy: [{ closeTime: "asc" }, { symbol: "asc" }],
  });
  const tradeBySymbol = new Map(materializedTrades.map((trade) => [trade.symbol, trade]));
  const groupKeys = [];

  for (const trade of tradeSpecs) {
    const materializedTrade = tradeBySymbol.get(trade.symbol);
    assertMaterializedTrade(materializedTrade, trade);

    const groupKey = materializedTrade.groupKey;
    groupKeys.push(groupKey);

    await prisma.closedTradeNote.create({
      data: {
        id: `demo-note-${trade.symbol}`,
        groupKey,
        content: trade.review.content,
        setup: trade.review.setup,
        thesis: trade.review.thesis,
        entryReview: trade.review.entryReview,
        exitReview: trade.review.exitReview,
        mistake: trade.review.mistake,
        lesson: trade.review.lesson,
        followUp: trade.review.followUp,
      },
    });

    await prisma.closedTradeChartLayout.create({
      data: {
        id: `demo-layout-${trade.symbol}`,
        closedTradeGroupKey: groupKey,
        layoutMode: "one-plus-two",
        panelsJson: JSON.stringify([
          { id: "panel-1", symbol: trade.symbol, timeframe: "5m", compareSymbol: null, rangePreset: "trade" },
          { id: "panel-2", symbol: trade.symbol, timeframe: "1h", compareSymbol: null, rangePreset: "post" },
          { id: "panel-3", symbol: trade.symbol, timeframe: "1d", compareSymbol: null, rangePreset: "3m" },
        ]),
      },
    });

    await prisma.closedTradeAnnotation.createMany({
      data: [
        {
          id: `demo-annotation-entry-${trade.symbol}`,
          closedTradeGroupKey: groupKey,
          panelId: "panel-1",
          symbol: trade.symbol,
          timeframe: "5m",
          scope: "TRADE",
          type: "entry",
          pointsJson: JSON.stringify([
            { time: Math.floor(materializedTrade.openTime.getTime() / 1000), price: materializedTrade.avgEntryPrice },
          ]),
          price: materializedTrade.avgEntryPrice,
          text: "Entry plan",
          styleJson: JSON.stringify({ color: trade.direction === "LONG" ? "#16a34a" : "#dc2626" }),
        },
        {
          id: `demo-annotation-target-${trade.symbol}`,
          closedTradeGroupKey: groupKey,
          panelId: null,
          symbol: trade.symbol,
          timeframe: null,
          scope: "SYMBOL",
          type: "target",
          pointsJson: JSON.stringify([
            { time: Math.floor(materializedTrade.closeTime.getTime() / 1000), price: materializedTrade.avgExitPrice },
          ]),
          price: materializedTrade.avgExitPrice,
          text: "Review target",
          styleJson: JSON.stringify({ color: "#2563eb" }),
        },
      ],
    });

    await prisma.closedTradeAnnotationState.create({
      data: { closedTradeGroupKey: groupKey, version: 1 },
    });
  }

  await prisma.marketCandle.createMany({
    data: mergeCandleOverrides([
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOA", "5m", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 99.5, 0.0015),
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOA", "1h", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 93, 0.01),
      ...sessionDailyCandleRows(expectedUsEquitiesBarStarts, "DEMOA", "2025-12-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", 82, 0.12),
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOB", "5m", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 63.2, -0.0008),
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOB", "1h", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 67, -0.005),
      ...sessionDailyCandleRows(expectedUsEquitiesBarStarts, "DEMOB", "2025-12-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", 72, -0.03),
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOC", "5m", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 45.2, -0.0009),
      ...sessionCandleRows(expectedUsEquitiesBarStarts, "DEMOC", "1h", "2026-05-01T00:00:00.000Z", "2026-07-10T23:59:59.000Z", 49, -0.006),
      ...sessionDailyCandleRows(expectedUsEquitiesBarStarts, "DEMOC", "2025-12-01T00:00:00.000Z", "2026-12-31T23:59:59.000Z", 55, -0.05),
    ], [
      { id: "DEMOA-5m-entry", symbol: "DEMOA", timeframe: "5m", time: "2026-06-17T13:35:00.000Z", open: 100.9, high: 101.5, low: 100.75, close: 101.25, volume: 1200 },
      { id: "DEMOA-5m-scale", symbol: "DEMOA", timeframe: "5m", time: "2026-06-17T14:20:00.000Z", open: 104.2, high: 104.95, low: 104.0, close: 104.7, volume: 1400 },
      { id: "DEMOA-5m-exit", symbol: "DEMOA", timeframe: "5m", time: "2026-06-17T16:45:00.000Z", open: 105.8, high: 106.7, low: 105.65, close: 106.35, volume: 1800 },
      { id: "DEMOA-1h-entry", symbol: "DEMOA", timeframe: "1h", time: "2026-06-17T13:00:00.000Z", open: 100.7, high: 101.7, low: 100.5, close: 101.35, volume: 7200 },
      { id: "DEMOA-1h-scale", symbol: "DEMOA", timeframe: "1h", time: "2026-06-17T14:00:00.000Z", open: 103.9, high: 105.05, low: 103.7, close: 104.75, volume: 7600 },
      { id: "DEMOA-1h-exit", symbol: "DEMOA", timeframe: "1h", time: "2026-06-17T16:00:00.000Z", open: 105.5, high: 106.85, low: 105.35, close: 106.45, volume: 8300 },
      { id: "DEMOA-1d-trade", symbol: "DEMOA", timeframe: "1d", time: "2026-06-17T00:00:00.000Z", open: 100.4, high: 106.9, low: 100.2, close: 106.45, volume: 120000 },
      { id: "DEMOB-5m-entry", symbol: "DEMOB", timeframe: "5m", time: "2026-06-18T13:40:00.000Z", open: 62.15, high: 62.7, low: 62.0, close: 62.35, volume: 1300 },
      { id: "DEMOB-5m-exit", symbol: "DEMOB", timeframe: "5m", time: "2026-06-18T15:10:00.000Z", open: 61.25, high: 61.4, low: 60.75, close: 60.95, volume: 1500 },
      { id: "DEMOB-1h-entry", symbol: "DEMOB", timeframe: "1h", time: "2026-06-18T13:00:00.000Z", open: 62.0, high: 62.85, low: 61.9, close: 62.3, volume: 7000 },
      { id: "DEMOB-1h-exit", symbol: "DEMOB", timeframe: "1h", time: "2026-06-18T15:00:00.000Z", open: 61.35, high: 61.55, low: 60.65, close: 60.9, volume: 7600 },
      { id: "DEMOB-1d-trade", symbol: "DEMOB", timeframe: "1d", time: "2026-06-18T00:00:00.000Z", open: 62.0, high: 62.9, low: 60.5, close: 60.9, volume: 118000 },
      { id: "DEMOC-5m-premarket-open", symbol: "DEMOC", timeframe: "5m", time: "2026-06-18T12:00:00.000Z", open: 45.3, high: 45.4, low: 45.0, close: 45.1, volume: 1100 },
      { id: "DEMOC-5m-entry", symbol: "DEMOC", timeframe: "5m", time: "2026-06-18T12:05:00.000Z", open: 45.05, high: 45.15, low: 44.55, close: 44.75, volume: 1500 },
      { id: "DEMOC-5m-premarket-close", symbol: "DEMOC", timeframe: "5m", time: "2026-06-18T12:10:00.000Z", open: 44.75, high: 44.9, low: 44.6, close: 44.7, volume: 1250 },
      { id: "DEMOC-5m-cover-1", symbol: "DEMOC", timeframe: "5m", time: "2026-06-18T16:30:00.000Z", open: 43.25, high: 43.35, low: 42.75, close: 42.95, volume: 1700 },
      { id: "DEMOC-5m-cover-2", symbol: "DEMOC", timeframe: "5m", time: "2026-06-22T13:50:00.000Z", open: 41.95, high: 42.1, low: 41.55, close: 41.7, volume: 1900 },
      { id: "DEMOC-1h-entry", symbol: "DEMOC", timeframe: "1h", time: "2026-06-18T12:00:00.000Z", open: 45.2, high: 45.35, low: 44.5, close: 44.75, volume: 7800 },
      { id: "DEMOC-1h-cover-1", symbol: "DEMOC", timeframe: "1h", time: "2026-06-18T16:00:00.000Z", open: 43.35, high: 43.45, low: 42.7, close: 42.95, volume: 8200 },
      { id: "DEMOC-1h-cover-2", symbol: "DEMOC", timeframe: "1h", time: "2026-06-22T13:00:00.000Z", open: 42.1, high: 42.25, low: 41.5, close: 41.7, volume: 8700 },
      { id: "DEMOC-1d-entry", symbol: "DEMOC", timeframe: "1d", time: "2026-06-18T00:00:00.000Z", open: 45.35, high: 45.5, low: 42.65, close: 42.95, volume: 126000 },
      { id: "DEMOC-1d-cover-2", symbol: "DEMOC", timeframe: "1d", time: "2026-06-22T00:00:00.000Z", open: 42.25, high: 42.35, low: 41.45, close: 41.7, volume: 130000 },
    ]),
    skipDuplicates: true,
  });

  const [momentumTag, lessonTag, mistakeTag] = await Promise.all([
    prisma.tag.upsert({ where: { name: "demo-momentum" }, update: {}, create: { name: "demo-momentum" } }),
    prisma.tag.upsert({ where: { name: "demo-good-scaleout" }, update: {}, create: { name: "demo-good-scaleout" } }),
    prisma.tag.upsert({ where: { name: "demo-late-entry" }, update: {}, create: { name: "demo-late-entry" } }),
  ]);

  await prisma.closedTradeTag.createMany({
    data: [
      { closedTradeGroupKey: groupKeys[0], tagId: momentumTag.id },
      { closedTradeGroupKey: groupKeys[0], tagId: lessonTag.id },
      { closedTradeGroupKey: groupKeys[1], tagId: mistakeTag.id },
      { closedTradeGroupKey: groupKeys[2], tagId: momentumTag.id },
    ],
    skipDuplicates: true,
  });

  const playbook = await prisma.journalPlaybook.create({
    data: {
      id: "demo-playbook-opening-drive",
      name: "Demo Opening Drive",
      setupType: "Momentum continuation",
      description: "Demo playbook for reviewing execution quality after opening drive trades.",
      idealConditions: "Relative strength, market support, reclaim and hold above VWAP.",
      invalidationRules: "Failing reclaim, heavy reversal volume, or first stop breach.",
      marketRegimeFit: "Best in risk-on or mixed tape with clear leadership.",
      rules: {
        create: [
          { id: "demo-rule-market", text: "Index trend supports the trade direction.", category: "CONTEXT", required: true, sortOrder: 0 },
          { id: "demo-rule-entry", text: "Entry occurs after pullback confirmation.", category: "ENTRY", required: true, sortOrder: 1 },
          { id: "demo-rule-scale", text: "Scale-out plan is defined before entry.", category: "EXIT", required: false, sortOrder: 2 },
        ],
      },
    },
  });

  const journalA = await prisma.journalEntry.create({
    data: {
      id: "demo-journal-a",
      symbol: "DEMOA",
      tradeTitle: "Demo opening drive long",
      ideaDate: toDate("2026-06-17T13:10:00.000Z"),
      entryEndAt: toDate("2026-06-17T13:40:00.000Z"),
      direction: "LONG",
      status: "PLAYBOOK",
      tradeStatus: "Closed",
      playbookId: playbook.id,
      setup: "Opening drive",
      timeframe: "5min",
      macroSentiment: "BULLISH",
      thesis: "DEMOA held the first pullback while the market stayed supportive.",
      trigger: "Break above the first five-minute pivot.",
      riskPlan: "Risk below the pullback low.",
      idealExecutionPlan: "Enter half size on reclaim, add only if volume expands.",
      marketContext: "Indexes held prior day highs.",
      peerContext: "Peer group also pushing higher.",
      rating: 4,
      lessonLearned: "Scaling into liquidity improved the average exit.",
      plannedEntry: 101,
      plannedStop: 99.8,
      plannedTarget1: 104.5,
      plannedTarget2: 106.2,
      expectedR: 3,
      actualTriggerAt: toDate("2026-06-17T13:35:00.000Z"),
      mfeR: 3.2,
      maeR: -0.4,
      bestExitR: 3.2,
      outcomeStatus: "TRIGGERED",
      outcomeNotes: "Clean trigger and good follow-through.",
      confidenceScore: 5,
      planClarityScore: 5,
      preparationScore: 4,
      patienceScore: 4,
      ruleAdherenceScore: 5,
      wouldTakeAgain: true,
      marketRegime: "RISK_ON",
      spyTrend: "BULLISH",
      qqqTrend: "BULLISH",
      iwmTrend: "NEUTRAL",
      sectorTrend: "BULLISH",
      sectorEtf: "DEMOX",
      charts: {
        create: [
          {
            id: "demo-journal-chart-a",
            symbol: "DEMOA",
            timeframe: "5min",
            purpose: "REVIEW",
            caption: "Execution review with ideal entry and scale-out zones.",
            markers: {
              create: [
                { id: "demo-marker-a-entry", markerType: "IDEAL_ENTRY", time: toDate("2026-06-17T13:35:00.000Z"), price: 101.2, label: "Entry" },
                { id: "demo-marker-a-target", markerType: "TARGET", time: toDate("2026-06-17T16:45:00.000Z"), price: 106.25, label: "Exit" },
              ],
            },
          },
        ],
      },
      tags: {
        create: [
          { tagId: momentumTag.id, category: "SETUP" },
          { tagId: lessonTag.id, category: "LESSON" },
        ],
      },
      ruleChecks: {
        create: [
          { id: "demo-check-market", playbookRuleId: "demo-rule-market", status: "PASS", notes: "Market context supported the long." },
          { id: "demo-check-entry", playbookRuleId: "demo-rule-entry", status: "PASS", notes: "Entry waited for reclaim." },
          { id: "demo-check-scale", playbookRuleId: "demo-rule-scale", status: "PASS", notes: "Scale-out was pre-planned." },
        ],
      },
    },
  });

  const journalB = await prisma.journalEntry.create({
    data: {
      id: "demo-journal-b",
      symbol: "DEMOB",
      tradeTitle: "Demo failed breakout review",
      ideaDate: toDate("2026-06-18T13:20:00.000Z"),
      direction: "LONG",
      status: "INVALIDATED",
      tradeStatus: "Closed",
      setup: "Failed breakout",
      timeframe: "5min",
      macroSentiment: "NEUTRAL",
      thesis: "DEMOB needed a clean reclaim but stalled under supply.",
      trigger: "Breakout above premarket high.",
      riskPlan: "Stop under reclaim candle.",
      idealExecutionPlan: "Wait for confirmation before buying.",
      missedReason: "Bought before confirmation.",
      lessonLearned: "Do not anticipate breakouts in mixed tape.",
      plannedEntry: 62.2,
      plannedStop: 61.2,
      plannedTarget1: 64,
      outcomeStatus: "FAILED",
      outcomeNotes: "Trigger failed and stop was respected.",
      confidenceScore: 4,
      planClarityScore: 5,
      preparationScore: 5,
      patienceScore: 3,
      ruleAdherenceScore: 5,
      wouldTakeAgain: false,
      marketRegime: "MIXED",
      charts: {
        create: [{ id: "demo-journal-chart-b", symbol: "DEMOB", timeframe: "5min", purpose: "REVIEW", caption: "Failed breakout and stop discipline." }],
      },
      tags: {
        create: [
          { tagId: mistakeTag.id, category: "MISTAKE" },
          { tagId: momentumTag.id, category: "SETUP" },
        ],
      },
    },
  });

  await prisma.journalPlaybookExample.create({
    data: {
      id: "demo-playbook-example-a",
      playbookId: playbook.id,
      journalEntryId: journalA.id,
      chartId: "demo-journal-chart-a",
      note: "Good example of scaling out against planned targets.",
      sortOrder: 0,
    },
  });

  await prisma.journalReview.create({
    data: {
      id: "demo-weekly-review",
      period: "WEEKLY",
      startDate: utcDay("2026-06-15"),
      endDate: utcDay("2026-06-21"),
      summary: "DEMO_WORKSTATION Weekly review: winners came from planned exits; loser came from early entry.",
      bestIdea: "DEMOA opening drive long.",
      bestIdeaEntryId: journalA.id,
      worstMiss: "DEMOB early breakout entry.",
      worstMissEntryId: journalB.id,
      recurringLesson: "Wait for confirmation in mixed market regimes.",
      nextFocus: "Only take opening drive trades with market alignment.",
      actions: {
        create: [
          { id: "demo-review-action-a", label: "Review first pullback entries before the open.", status: "OPEN", journalEntryId: journalA.id, dueDate: utcDay("2026-06-24") },
          { id: "demo-review-action-b", label: "Add a pre-entry confirmation checklist.", status: "OPEN", journalEntryId: journalB.id, dueDate: utcDay("2026-06-24") },
        ],
      },
    },
  });

  await prisma.journalSavedView.create({
    data: {
      id: "demo-saved-view",
      name: "Demo Review Queue",
      viewType: "IDEAS",
      filtersJson: JSON.stringify({ symbols: DEMO_SYMBOLS, outcomes: ["TRIGGERED", "FAILED"] }),
      sortKey: "ideaDate",
      sortDirection: "desc",
    },
  });

  await prisma.dayNote.create({
    data: {
      id: "demo-day-note",
      accountId: account.id,
      date: utcDay("2026-06-18"),
      content: "Demo day note: mixed tape, lower confidence after first failed breakout.",
      tags: { create: [{ tagId: mistakeTag.id }] },
    },
  });

  console.log(`Seeded demo workstation data for ${DEMO_ACCOUNT_CODE}.`);
  console.log(`Demo closed trades: ${groupKeys.length}. Demo symbols: ${DEMO_SYMBOLS.join(", ")}.`);
}

async function main() {
  if (!process.argv.includes("--demo")) {
    console.log("No seed mode selected. Run `npm run prisma:seed -- --demo` to reset and seed deterministic demo workstation data.");
    return;
  }

  const safety = await authorizeDemoSeed();
  await seedDemo(safety);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
