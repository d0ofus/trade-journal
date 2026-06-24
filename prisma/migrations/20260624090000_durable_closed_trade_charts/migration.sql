CREATE TABLE "ClosedTradeChartLayout" (
    "id" TEXT NOT NULL,
    "closedTradeGroupKey" TEXT NOT NULL,
    "layoutMode" TEXT NOT NULL DEFAULT 'single',
    "panelsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosedTradeChartLayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClosedTradeAnnotation" (
    "id" TEXT NOT NULL,
    "closedTradeGroupKey" TEXT NOT NULL,
    "panelId" TEXT,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'TRADE',
    "type" TEXT NOT NULL,
    "pointsJson" TEXT NOT NULL DEFAULT '[]',
    "price" DOUBLE PRECISION,
    "text" TEXT,
    "styleJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClosedTradeAnnotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketCandle" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketCandle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClosedTradeChartLayout_closedTradeGroupKey_key" ON "ClosedTradeChartLayout"("closedTradeGroupKey");
CREATE INDEX "ClosedTradeChartLayout_closedTradeGroupKey_idx" ON "ClosedTradeChartLayout"("closedTradeGroupKey");
CREATE INDEX "ClosedTradeAnnotation_closedTradeGroupKey_symbol_timeframe_idx" ON "ClosedTradeAnnotation"("closedTradeGroupKey", "symbol", "timeframe");
CREATE INDEX "ClosedTradeAnnotation_closedTradeGroupKey_scope_idx" ON "ClosedTradeAnnotation"("closedTradeGroupKey", "scope");
CREATE UNIQUE INDEX "MarketCandle_symbol_timeframe_time_source_key" ON "MarketCandle"("symbol", "timeframe", "time", "source");
CREATE INDEX "MarketCandle_symbol_timeframe_time_idx" ON "MarketCandle"("symbol", "timeframe", "time");
CREATE INDEX "MarketCandle_source_updatedAt_idx" ON "MarketCandle"("source", "updatedAt");

ALTER TABLE "ClosedTradeChartLayout" ADD CONSTRAINT "ClosedTradeChartLayout_closedTradeGroupKey_fkey"
FOREIGN KEY ("closedTradeGroupKey") REFERENCES "ClosedTrade"("groupKey") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClosedTradeAnnotation" ADD CONSTRAINT "ClosedTradeAnnotation_closedTradeGroupKey_fkey"
FOREIGN KEY ("closedTradeGroupKey") REFERENCES "ClosedTrade"("groupKey") ON DELETE CASCADE ON UPDATE CASCADE;
