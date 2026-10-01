const moneyFormatters = new Map<string, Intl.NumberFormat>();
export const money = (value: number, currency = "USD") => {
  const code = currency || "USD";
  let formatter = moneyFormatters.get(code);
  if (!formatter) { formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: 2 }); moneyFormatters.set(code, formatter); }
  return formatter.format(value);
};
export const time = (value: number) => new Date(value * 1000).toISOString().slice(11, 19);
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const date = (value: number) => dateFormatter.format(new Date(value * 1000));
