import { endOfDay, startOfDay } from "date-fns";

export type TradeFilters = {
  from?: string;
  to?: string;
  symbol?: string;
  direction?: string;
  side?: string;
  account?: string;
  tag?: string;
  strategy?: string;
  includeStale?: boolean;
};

type WhereClause = Record<string, unknown>;

function executionCriteria(filters: TradeFilters) {
  const criteria: WhereClause = {};

  if (filters.strategy) {
    criteria.execution = {
      strategy: { equals: filters.strategy },
    };
  }

  return criteria;
}

function normalizeDirection(value?: string) {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "LONG" || normalized === "BUY") return "LONG";
  if (normalized === "SHORT" || normalized === "SELL") return "SHORT";
  return "";
}

function tagCriteria(tag: string) {
  return {
    OR: [
      { tags: { some: { tag: { name: { equals: tag } } } } },
      { executions: { some: { execution: { tags: { some: { tag: { name: { equals: tag } } } } } } } },
    ],
  };
}

export function normalizeTradeTagName(value?: string) {
  return value?.trim().replace(/^#+/, "").toLowerCase() || "";
}

export function buildClosedTradeWhere(filters: TradeFilters) {
  const where: WhereClause = {};
  const and: WhereClause[] = [];
  const tag = normalizeTradeTagName(filters.tag);

  if (!filters.includeStale) {
    where.isStale = false;
  }

  if (filters.from || filters.to) {
    where.tradeDate = {
      gte: filters.from ? startOfDay(new Date(filters.from)) : undefined,
      lte: filters.to ? endOfDay(new Date(filters.to)) : undefined,
    };
  }

  if (filters.symbol) {
    where.symbol = { equals: filters.symbol };
  }

  const account = filters.account?.trim();
  if (account) {
    where.account = { ibkrAccount: { equals: account } };
  }

  const direction = normalizeDirection(filters.direction ?? filters.side);
  if (direction) {
    where.direction = direction;
  }

  const executionMatch = executionCriteria(filters);
  if (Object.keys(executionMatch).length > 0) {
    and.push({ executions: { some: executionMatch } });
  }

  if (tag) {
    and.push(tagCriteria(tag));
  }

  if (and.length > 0) {
    where.AND = and;
  }

  return where;
}
