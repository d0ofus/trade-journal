import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { inspectDatabase } from "../../../scripts/neon-retention-inventory.mjs";
import { removeVerifiedSchema, eligibleResource } from "../../../scripts/neon-retention-cleanup.mjs";
const schema = "trade_journal_phase0_test";
async function fixture() {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA ${schema}`);
  await prisma.$executeRawUnsafe(`CREATE TABLE ${schema}.sample (id int PRIMARY KEY, note text)`);
  await prisma.$executeRawUnsafe(`INSERT INTO ${schema}.sample VALUES (1,'preserve me')`);
  const database = await inspectDatabase(process.env.DATABASE_URL!, new URL(process.env.DATABASE_URL!).pathname.slice(1));
  return { database, resource: database.resources.find(r => r.schema === schema)! };
}
afterEach(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS public.retention_dependency_test RESTRICT');
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS ${schema}.sample RESTRICT`);
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schema} RESTRICT`);
});
describe("manifest cleanup on isolated PostgreSQL", () => {
  it("rejects drift without removing data", async () => {
    const { resource } = await fixture();
    await prisma.$executeRawUnsafe(`UPDATE ${schema}.sample SET note='changed'`);
    await expect(removeVerifiedSchema(prisma, resource)).rejects.toThrow("changed");
    expect(await prisma.$queryRawUnsafe(`SELECT note FROM ${schema}.sample`)).toEqual([{ note: "changed" }]);
  });
  it("refuses a dependency introduced after inspection and rolls back all removal", async () => {
    const { resource } = await fixture();
    await prisma.$executeRawUnsafe(`CREATE TABLE public.retention_dependency_test (id int REFERENCES ${schema}.sample(id))`);
    await expect(removeVerifiedSchema(prisma, resource)).rejects.toThrow();
    expect(await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${schema}.sample`)).toEqual([{ n: 1 }]);
  });
  it("skips a resource being used by another connection without terminating it", async () => {
    const { resource } = await fixture();
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`LOCK TABLE ${schema}.sample IN ACCESS SHARE MODE`);
      await expect(removeVerifiedSchema(prisma, resource)).rejects.toThrow();
      expect(await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM ${schema}.sample`)).toEqual([{ n: 1 }]);
    });
  });
  it("removes only the unchanged exact resource and requires archive/config evidence", async () => {
    const { database, resource } = await fixture();
    const checked = { ...database, identity: { ...database.identity, datname: "neondb" }, sessions: [] };
    expect(eligibleResource(checked, resource, null, null)).toBe(false);
    expect(eligibleResource(checked, resource, { verified: true }, { references: [{ referencedCandidates: [] }], localEnvReferences: 0 })).toBe(true);
    await removeVerifiedSchema(prisma, resource);
    expect(await prisma.$queryRawUnsafe(`SELECT nspname FROM pg_namespace WHERE nspname='${schema}'`)).toEqual([]);
  });
});
