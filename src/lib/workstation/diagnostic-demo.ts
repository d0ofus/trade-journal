import type { Candle, Trade } from "./types";
const at = (value: string) => Date.parse(value) / 1000;
export const diagnosticDemoTrade: Trade = {
  id: "demo-mu-diagnostic", symbol: "MU", name: "Execution timing example", account: "Diagnostics · Demo", currency: "USD", direction: "LONG",
  openTime: at("2026-09-08T14:05:17Z"), closeTime: at("2026-09-08T15:09:25Z"), entry: 1000, exit: 1008.71, pnl: 52.26, fees: 0, quantity: 6, openQuantity: 0,
  executions: [
    { id: "demo-mu-entry", time: at("2026-09-08T14:05:17Z"), side: "BUY", quantity: 6, price: 1000, commission: 0, fees: 0 },
    { id: "demo-mu-sell", time: at("2026-09-08T15:09:25Z"), side: "SELL", quantity: 6, price: 1008.71, commission: 0, fees: 0 },
  ].map(e => ({ ...e, provenance: { timezoneStatus: "unverified", timezone: null, source: "Timezone-free timestamp example; synthetic review" } })) as Trade["executions"],
};
// The two comparison bars reproduce the audited Yahoo response. Other context is synthetic.
export const diagnosticComparisonCandles: Candle[] = [
  { time: at("2026-09-08T15:05:00Z"), open: 1016.5198974609375, high: 1017.6599731445312, low: 1015.3900146484375, close: 1016.8800048828125, volume: 100000 },
  { time: at("2026-09-08T19:05:00Z"), open: 1011.5800170898438, high: 1012.1972045898438, low: 1008, close: 1008.5, volume: 100000 },
];
