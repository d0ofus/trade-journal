export const intervals = ["5m", "10m", "15m", "1h", "1d", "1wk"] as const;
export type Interval = (typeof intervals)[number];
export const seconds: Record<Interval, number> = {
  "5m": 300,
  "10m": 600,
  "15m": 900,
  "1h": 3600,
  "1d": 86400,
  "1wk": 604800,
};
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
export type Execution = {
  id: string;
  time: number;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  commission: number;
  fees: number;
  provenance?: { timezoneStatus: "verified" | "user-confirmed" | "unverified"; timezone: string | null; source: string; parserVersion?: string | null; storedTime?: number; brokerWallTime?: string; confirmationBasis?: string; interpretationReason?: string; interpretationStatus?: "applied" | "stale" | "unresolved" | "pending"; interpretationVersion?: string };
};
export type Trade = {
  assetType?: string;
  brokerTradeDate?: string;
  timeInterpretationVersion?: string;
  chartSession?: "regular" | "extended";
  id: string;
  symbol: string;
  name: string;
  account: string;
  currency: string;
  direction: "LONG" | "SHORT";
  openTime: number;
  closeTime: number;
  entry: number;
  exit: number;
  pnl: number;
  fees: number;
  quantity: number;
  openQuantity: number;
  executions: Execution[];
  stale?: boolean;
};
export const drawingTools = [
  "cursor",
  "horizontal",
  "ray",
  "trend",
  "arrow",
  "zone",
  "text",
  "price-note",
  "measure",
  "long",
  "short",
  "entry",
  "stop",
  "target",
  "exit",
] as const;
export type Tool = (typeof drawingTools)[number];
export type Point = { time: number; price: number };
export type Drawing = {
  id: string;
  tool: Exclude<Tool, "cursor">;
  points: Point[];
  text: string;
  color: string;
  width: number;
  dashed: boolean;
  locked: boolean;
  hidden: boolean;
  panel: string | null;
  createdAt: number;
};
export type Review = {
  notion?: import("./notion-template").NotionReview;
  setup: string;
  execution: string;
  takeaway: string;
  notes: string;
  thesis: string;
  exit: string;
  mistake: string;
  followUp: string;
  tags: string[];
  status: "Not reviewed" | "In progress" | "Reviewed";
  template: string;
  custom: Record<string, string>;
};
export type Evidence = {
  timeInterpretationVersion?: string;
  id: string;
  name: string;
  image: string;
  time: number;
  revision: number;
  timeframe: string;
};
export type TradeDocument = {
  schema: 1;
  revision: number;
  review: Review;
  drawings: Drawing[];
  evidence: Evidence[];
  updatedAt: string | null;
  noteUpdatedAt?: string | null;
  journalEntryId?: string | null;
  journalUpdatedAt?: string | null;
  legacy?: unknown;
};
export type ChartPanel = { id: string; interval: Interval; benchmark?: "off" | "SPY" | "QQQ"; beforeEntry?: boolean };
export type WorkspacePreferences = {
  executionColors?: { buy: string; sell: string };
  chartSession?: "auto" | "regular" | "extended";
  theme: "dark" | "light";
  panels: ChartPanel[];
  labels: "labels" | "compact" | "hidden";
  chartLabels?: import("./chart-labels").ChartLabels;
  linked: boolean;
  volume: boolean;
  averages: number[];
  magnet: boolean;
  keepTool: boolean;
  list: boolean;
  filtersExpanded?: boolean;
  journal: boolean;
  heading: boolean;
  bottomCollapsed: boolean;
  focusMode: boolean;
  chartArrangement: "left" | "top";
  chartSizing?: import("./chart-sizing").ChartSizing;
  dateLink: "independent" | "target";
  dock: unknown;
  presets: Record<string, unknown>;
  favorites: Tool[];
  style: { color: string; width: number; dashed: boolean };
  templates: Record<string, Partial<Review>>;
  exportColumns: string[];
};
export type CandleResult = {
  cache?: import("./candle-ranges").CandleCacheMetadata;
  identity?: string;
  candles: Candle[];
  warning: string;
  source: string;
  truncated?: boolean;
  provider?: { identity: string; provider: string; feed: string | null; adjustment: string; delaySeconds: number; cached: boolean; fallback: boolean };
  session?: CandleSession;
};
export type CandleSession = { timezone: string | null; calendar: "exchange" | "utc" | "unknown"; marketHours: "regular" | "extended" | "unknown"; aggregation?: string };
export interface WorkstationAdapter {
  benchmarkCandles?: (symbol: "SPY" | "QQQ", trade: Trade, interval: Interval, signal: AbortSignal, range: { from: number; to: number }, mode?: "cache" | "fill") => Promise<CandleResult>;
  metrics?: (trade: Trade, signal: AbortSignal) => Promise<import("./market-metrics").MarketMetrics>;
  loadView?(id: string): Promise<import("./trade-view").SavedTradeView>;
  saveView?(id: string, view: import("./trade-view").TradeView, expectedRevision: number): Promise<import("./trade-view").SavedTradeView>;
  cachedCandles?: WorkstationAdapter["candles"];
  refreshCandles?: WorkstationAdapter["candles"];
  mode: "demo" | "application";
  load(id: string): Promise<TradeDocument>;
  save(
    id: string,
    document: TradeDocument,
    expectedRevision: number,
  ): Promise<TradeDocument>;
  candles(
    trade: Trade,
    interval: Interval,
    signal?: AbortSignal,
    range?: { from: number; to: number },
    identity?: string,
  ): Promise<CandleResult>;
  reset?(): void;
}
export const emptyReview = (): Review => ({
  setup: "",
  execution: "",
  takeaway: "",
  notes: "",
  thesis: "",
  exit: "",
  mistake: "",
  followUp: "",
  tags: [],
  status: "Not reviewed",
  template: "Quick review",
  custom: {},
});
export const emptyDocument = (): TradeDocument => ({
  schema: 1,
  revision: 0,
  review: emptyReview(),
  drawings: [],
  evidence: [],
  updatedAt: null,
});
export const defaultPreferences = (): WorkspacePreferences => ({
  theme: "dark",
  panels: [
    { id: "chart-1", interval: "5m" },
    { id: "chart-2", interval: "1h" },
    { id: "chart-3", interval: "1d" },
  ],
  labels: "labels",
  linked: true,
  volume: true,
  averages: [20, 50],
  magnet: false,
  keepTool: false,
  list: true,
  filtersExpanded: false,
  journal: true,
  heading: false,
  bottomCollapsed: true,
  focusMode: false,
  chartArrangement: "left",
  dateLink: "target",
  dock: null,
  presets: {},
  favorites: ["ray", "text", "measure"],
  style: { color: "#a5b4fc", width: 1.5, dashed: false },
  templates: {},
  exportColumns: [],
});
export class RevisionConflict extends Error {
  constructor() {
    super(
      "This review changed in another tab. Your draft is preserved. Reload the saved version or export your draft before continuing.",
    );
  }
}
