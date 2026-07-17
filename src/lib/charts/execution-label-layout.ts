export function packExecutionLabelCenters(
  preferredCenters: number[],
  minCenter: number,
  maxCenter: number,
  preferredGap: number,
) {
  if (preferredCenters.length === 0) return [];
  if (preferredCenters.length === 1) {
    return [Math.min(maxCenter, Math.max(minCenter, preferredCenters[0]))];
  }

  const availableHeight = Math.max(0, maxCenter - minCenter);
  const gap = Math.min(Math.max(0, preferredGap), availableHeight / (preferredCenters.length - 1));
  const packed: number[] = [];

  for (const preferred of preferredCenters) {
    const prior = packed.at(-1);
    packed.push(Math.max(minCenter, Math.min(maxCenter, preferred), prior == null ? minCenter : prior + gap));
  }

  packed[packed.length - 1] = Math.min(maxCenter, packed.at(-1) ?? maxCenter);
  for (let index = packed.length - 2; index >= 0; index -= 1) {
    packed[index] = Math.max(minCenter, Math.min(packed[index], packed[index + 1] - gap));
  }

  return packed;
}
