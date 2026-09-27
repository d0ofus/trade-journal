import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { reviewStatus, type ReviewStatusSummary } from "@/lib/workstation/review-status";

/** Project scalar metadata inside PostgreSQL: review text and image payloads never leave the database. */
export async function loadReviewStatuses(groupKeys: string[]): Promise<ReviewStatusSummary[]> {
  const keys = [...new Set(groupKeys)], result: ReviewStatusSummary[] = [];
  for (let offset = 0; offset < keys.length; offset += 500) {
    const rows = await prisma.$queryRaw<Array<{ groupKey: string; status: string | null; revision: number; updatedAt: Date | null }>>(Prisma.sql`
      SELECT t."groupKey", coalesce(n."workstationVersion", 0) AS revision, n."updatedAt",
        CASE WHEN n."workstationJson" IS NULL OR n."workstationJson" = '' THEN 'Not reviewed'
          WHEN pg_input_is_valid(n."workstationJson", 'jsonb') THEN
            CASE WHEN jsonb_typeof(n."workstationJson"::jsonb) = 'object' THEN
              CASE WHEN n."workstationJson"::jsonb -> 'review' IS NULL THEN 'Not reviewed'
                WHEN jsonb_typeof(n."workstationJson"::jsonb -> 'review') = 'object' THEN
                  CASE WHEN n."workstationJson"::jsonb #> '{review,status}' IS NULL THEN 'Not reviewed'
                    ELSE n."workstationJson"::jsonb #>> '{review,status}' END END END
          ELSE NULL END AS status
      FROM "ClosedTrade" t LEFT JOIN "ClosedTradeNote" n ON n."groupKey" = t."groupKey"
      WHERE t."groupKey" IN (${Prisma.join(keys.slice(offset, offset + 500))})
    `);
    result.push(...rows.map(row => ({ ...row, status: reviewStatus(row.status), updatedAt: row.updatedAt?.toISOString() ?? null })));
  }
  return result;
}
