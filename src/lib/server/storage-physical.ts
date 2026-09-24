import { prisma } from "@/lib/prisma";

/** Directory scans can be slow on hosts with many databases. Never hold up every dashboard group. */
export async function readPhysicalStorage() {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
    const [row] = await tx.$queryRaw<{ currentBytes: bigint; branchBytes: bigint; cacheBytes: bigint; metricCacheBytes: bigint; measuredAt: Date }[]>`
      SELECT statement_timestamp() AS "measuredAt", pg_database_size(current_database())::bigint AS "currentBytes",
        (SELECT sum(pg_database_size(oid)) FROM pg_database WHERE NOT datistemplate)::bigint AS "branchBytes",
        (SELECT coalesce(sum(pg_total_relation_size(to_regclass(quote_ident(name)))),0) FROM unnest(ARRAY[
          'WorkstationCandleChunk','WorkstationCandleCoverage','WorkstationCandleJob','WorkstationCandleLease','WorkstationMetricCache'
        ]) name)::bigint AS "cacheBytes",
        coalesce(pg_total_relation_size(to_regclass('"WorkstationMetricCache"')),0)::bigint AS "metricCacheBytes"`;
    return row;
  }, { maxWait: 2_000, timeout: 8_000 });
}
