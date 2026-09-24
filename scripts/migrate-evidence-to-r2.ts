import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });

async function main() {
  const apply = process.argv.includes("--apply"), after = process.argv.find(a => a.startsWith("--after="))?.slice(8);
  if (apply && process.env.EVIDENCE_LEGACY_MIGRATION_APPROVED !== "1") throw new Error("Migration execution requires EVIDENCE_LEGACY_MIGRATION_APPROVED=1 after a verified database-and-image backup. Dry-run is the default.");
  const { prisma } = await import("../src/lib/prisma");
  const { migrateInlineReviewEvidence } = await import("../src/lib/server/evidence-migration");
  try {
    const rows = await prisma.closedTradeNote.findMany({ where: { workstationJson: { contains: "data:image/png;base64," }, ...(after ? { groupKey: { gt: after } } : {}) }, orderBy: { groupKey: "asc" }, take: 10 });
    for (const row of rows) {
      const doc = JSON.parse(row.workstationJson!), images = (doc.evidence ?? []).filter((e: { asset?: unknown; image?: string }) => !e.asset && e.image?.startsWith("data:image/png;base64,"));
      const result = apply ? await migrateInlineReviewEvidence(row.groupKey, process.env.EVIDENCE_MIGRATION_OWNER_ID ?? "local-user") : { images: images.length, dryRun: true };
      console.log(JSON.stringify({ tradeId: row.groupKey, ...result }));
    }
    console.log(JSON.stringify({ nextAfter: rows.at(-1)?.groupKey ?? null, boundedBatch: 10, note: "Repeat with --after=<nextAfter>. Retry a failed trade before advancing the cursor." }));
  } finally { await prisma.$disconnect(); }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : "Migration stopped"); process.exitCode = 1; });
