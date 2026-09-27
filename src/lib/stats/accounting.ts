/** Increment when accounting semantics change; included in materialization signatures. */
export const ACCOUNTING_VERSION = "2026-09-27.closed-v2";
export const LEGACY_OPTION_MULTIPLIER_SOURCE = "approved-legacy-occ-option-100:2026-09-27";

export function isLegacyOption(symbol: string) {
  return /\s+\d{6}[PC]\d{8}$/.test(symbol.trim());
}

export function accountingMetadata(input: {
  symbol: string; assetType?: string | null; contractMultiplier?: number | null;
}) {
  const option = input.assetType === "OPTION" || isLegacyOption(input.symbol);
  return {
    contractMultiplier: input.contractMultiplier ?? (option ? 100 : 1),
    multiplierSource: input.contractMultiplier != null ? "broker-archive" : option ? LEGACY_OPTION_MULTIPLIER_SOURCE : "unit-security",
    effectiveAssetType: option ? "OPTION" : input.assetType ?? "OTHER",
  };
}
