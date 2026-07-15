export interface OpeningPositionInstrumentIdentity {
  symbol: string;
  assetType?: string | null;
  currency?: string | null;
}

export interface OpeningPositionExecutionCandidate {
  accountId: string;
  executedAt: Date;
  currency?: string | null;
  instrument: OpeningPositionInstrumentIdentity;
}

export interface OpeningPositionSnapshotCandidate {
  accountId: string;
  date: Date;
  quantity: number;
  avgCost: number;
  currency?: string | null;
  instrument: OpeningPositionInstrumentIdentity;
}

export interface OpeningPosition {
  quantity: number;
  avgCost: number;
}

export function openingInstrumentIdentity(input: OpeningPositionInstrumentIdentity) {
  return [input.symbol, input.assetType ?? "", input.currency ?? ""].join("|");
}

export function openingPositionKey(accountId: string, instrument: OpeningPositionInstrumentIdentity) {
  return `${accountId}:${openingInstrumentIdentity(instrument)}`;
}

export function buildOpeningPositionMap(
  executions: OpeningPositionExecutionCandidate[],
  snapshots: OpeningPositionSnapshotCandidate[],
) {
  const firstExecutionAtByKey = new Map<string, number>();

  for (const execution of executions) {
    const key = openingPositionKey(execution.accountId, {
      symbol: execution.instrument.symbol,
      assetType: execution.instrument.assetType,
      currency: execution.currency ?? execution.instrument.currency,
    });
    const executedAt = execution.executedAt.getTime();
    const existing = firstExecutionAtByKey.get(key);
    if (existing === undefined || executedAt < existing) {
      firstExecutionAtByKey.set(key, executedAt);
    }
  }

  const aggregatedSnapshots = new Map<string, { date: number; quantity: number; costValue: number }>();

  for (const snapshot of snapshots) {
    const key = openingPositionKey(snapshot.accountId, {
      symbol: snapshot.instrument.symbol,
      assetType: snapshot.instrument.assetType,
      currency: snapshot.currency ?? snapshot.instrument.currency,
    });
    const firstExecutionAt = firstExecutionAtByKey.get(key);
    const snapshotDate = snapshot.date.getTime();
    if (firstExecutionAt === undefined || snapshotDate >= firstExecutionAt) continue;

    const existing = aggregatedSnapshots.get(key);
    if (existing && existing.date > snapshotDate) continue;

    if (!existing || existing.date < snapshotDate) {
      aggregatedSnapshots.set(key, {
        date: snapshotDate,
        quantity: snapshot.quantity,
        costValue: snapshot.quantity * snapshot.avgCost,
      });
      continue;
    }

    existing.quantity += snapshot.quantity;
    existing.costValue += snapshot.quantity * snapshot.avgCost;
  }

  const openingByAccountInstrument = new Map<string, OpeningPosition>();
  for (const [key, snapshot] of aggregatedSnapshots.entries()) {
    openingByAccountInstrument.set(key, {
      quantity: snapshot.quantity,
      avgCost: Math.abs(snapshot.quantity) > 0 ? snapshot.costValue / snapshot.quantity : 0,
    });
  }

  return openingByAccountInstrument;
}
