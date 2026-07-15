export type ClosedTradeRefreshPlan = {
  activeGroupKeys: string[];
  staleGroupKeys: string[];
  executionGroupKeysToReplace: string[];
};

export function planClosedTradeRefresh(existingGroupKeys: string[], computedGroupKeys: string[]): ClosedTradeRefreshPlan {
  const computed = new Set(computedGroupKeys);
  const activeGroupKeys = [...computed].sort();
  const staleGroupKeys = existingGroupKeys.filter((groupKey) => !computed.has(groupKey)).sort();

  return {
    activeGroupKeys,
    staleGroupKeys,
    executionGroupKeysToReplace: activeGroupKeys,
  };
}
