/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function toDate(value) {
  return new Date(value);
}

async function main() {
  await prisma.closedTradeNote.deleteMany();
  await prisma.executionTag.deleteMany();
  await prisma.tradeNote.deleteMany();
  await prisma.execution.deleteMany();
  await prisma.positionSnapshot.deleteMany();
  await prisma.position.deleteMany();
  await prisma.dailySnapshot.deleteMany();
  await prisma.symbolNoteTag.deleteMany();
  await prisma.dayNoteTag.deleteMany();
  await prisma.symbolNote.deleteMany();
  await prisma.dayNote.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.instrument.deleteMany();
  await prisma.account.deleteMany();

  const account = await prisma.account.create({
    data: {
      name: 'Main IBKR',
      ibkrAccount: 'DU1234567',
      baseCurrency: 'USD',
    },
  });

  const [spy, nvda, tsla] = await Promise.all([
    prisma.instrument.create({ data: { symbol: 'SPY', exchange: 'ARCA', assetType: 'ETF', currency: 'USD' } }),
    prisma.instrument.create({ data: { symbol: 'NVDA', exchange: 'NASDAQ', assetType: 'STOCK', currency: 'USD' } }),
    prisma.instrument.create({ data: { symbol: 'TSLA', exchange: 'NASDAQ', assetType: 'STOCK', currency: 'USD' } }),
  ]);

  const executions = [
    { key: 'seed-1', dt: '2026-02-20T14:35:00.000Z', side: 'BUY', qty: 100, price: 505.2, inst: spy, commission: 1.2, strategy: 'opening-range' },
    { key: 'seed-2', dt: '2026-02-20T17:01:00.000Z', side: 'SELL', qty: 100, price: 507.4, inst: spy, commission: 1.2, strategy: 'opening-range' },
    { key: 'seed-3', dt: '2026-02-21T14:41:00.000Z', side: 'BUY', qty: 40, price: 721.0, inst: nvda, commission: 1.0, strategy: 'breakout' },
    { key: 'seed-4', dt: '2026-02-21T15:15:00.000Z', side: 'BUY', qty: 20, price: 718.8, inst: nvda, commission: 1.0, strategy: 'breakout' },
    { key: 'seed-5', dt: '2026-02-21T19:00:00.000Z', side: 'SELL', qty: 60, price: 729.9, inst: nvda, commission: 1.1, strategy: 'breakout' },
    { key: 'seed-6', dt: '2026-02-24T15:02:00.000Z', side: 'SELL', qty: 50, price: 182.1, inst: tsla, commission: 1.4, strategy: 'trend-short' },
    { key: 'seed-7', dt: '2026-02-24T17:20:00.000Z', side: 'BUY', qty: 30, price: 179.4, inst: tsla, commission: 1.3, strategy: 'trend-short' },
  ];

  for (const row of executions) {
    await prisma.execution.create({
      data: {
        dedupeKey: row.key,
        accountId: account.id,
        instrumentId: row.inst.id,
        executedAt: toDate(row.dt),
        side: row.side,
        quantity: row.qty,
        price: row.price,
        commission: row.commission,
        currency: 'USD',
        orderId: row.key,
        strategy: row.strategy,
      },
    });
  }

  await prisma.position.createMany({
    data: [
      { accountId: account.id, instrumentId: spy.id, quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, instrumentId: nvda.id, quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, instrumentId: tsla.id, quantity: -20, avgCost: 182.1, unrealizedPnl: 48, currency: 'USD' },
    ],
  });

  await prisma.positionSnapshot.createMany({
    data: [
      { accountId: account.id, instrumentId: spy.id, date: toDate('2026-02-23T00:00:00.000Z'), quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, instrumentId: nvda.id, date: toDate('2026-02-23T00:00:00.000Z'), quantity: 0, avgCost: 0, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, instrumentId: tsla.id, date: toDate('2026-02-23T00:00:00.000Z'), quantity: -50, avgCost: 182.1, unrealizedPnl: 0, currency: 'USD' },
    ],
  });

  await prisma.dailySnapshot.createMany({
    data: [
      { accountId: account.id, date: toDate('2026-02-20T00:00:00.000Z'), equity: 100220, realizedPnl: 218, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, date: toDate('2026-02-21T00:00:00.000Z'), equity: 100690, realizedPnl: 470, unrealizedPnl: 0, currency: 'USD' },
      { accountId: account.id, date: toDate('2026-02-24T00:00:00.000Z'), equity: 100810, realizedPnl: 126, unrealizedPnl: 48, currency: 'USD' },
    ],
  });

  const [momentum, breakout] = await Promise.all([
    prisma.tag.create({ data: { name: 'momentum' } }),
    prisma.tag.create({ data: { name: 'breakout' } }),
  ]);

  const lastExec = await prisma.execution.findFirstOrThrow({ orderBy: { executedAt: 'desc' } });
  await prisma.tradeNote.create({
    data: {
      executionId: lastExec.id,
      content: 'Covered part of short into support, held runner for potential breakdown.',
    },
  });

  await prisma.executionTag.create({ data: { executionId: lastExec.id, tagId: momentum.id } });

  const dayNote = await prisma.dayNote.create({
    data: {
      accountId: account.id,
      date: toDate('2026-02-24T00:00:00.000Z'),
      content: 'Good execution discipline. Avoided chasing first move.',
    },
  });

  await prisma.dayNoteTag.create({ data: { dayNoteId: dayNote.id, tagId: breakout.id } });

  const symbolNote = await prisma.symbolNote.create({
    data: {
      accountId: account.id,
      instrumentId: tsla.id,
      thesis: 'Weak relative strength under 200-day MA; prefer short setups until reclaim.',
    },
  });

  await prisma.symbolNoteTag.create({ data: { symbolNoteId: symbolNote.id, tagId: momentum.id } });
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
