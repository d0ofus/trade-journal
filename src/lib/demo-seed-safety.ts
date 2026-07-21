import {
  assertTestDatabaseSafety,
  parsePostgresTarget,
  type TestDatabaseEnvironment,
} from "@/lib/test-database-safety";

export const SHARED_DEMO_SEED_CONFIRMATION = "DEMO-WORKSTATION";

export type DemoSeedAuthorization = {
  clearBackupAudits: boolean;
};

function isCi(env: TestDatabaseEnvironment) {
  const value = env.CI?.trim().toLowerCase();
  return value != null && value !== "" && value !== "0" && value !== "false";
}

function containsDemoTargetToken(value: string) {
  return /(?:^|[^a-z0-9])demo(?=$|[^a-z0-9])/i.test(value);
}

function assertSharedDemoTarget(env: TestDatabaseEnvironment) {
  if (!env.DATABASE_URL || !env.DIRECT_URL) {
    throw new Error("Demo seed refused. Shared-demo mode requires both database URLs.");
  }

  const databaseUrl = parsePostgresTarget(env.DATABASE_URL, "DATABASE_URL");
  const directUrl = parsePostgresTarget(env.DIRECT_URL, "DIRECT_URL");
  if (
    databaseUrl.host !== directUrl.host ||
    databaseUrl.database !== directUrl.database ||
    databaseUrl.schema !== directUrl.schema
  ) {
    throw new Error("Demo seed refused. Shared-demo database URLs must resolve to the same target.");
  }

  const dedicatedDemoTarget =
    containsDemoTargetToken(databaseUrl.database) ||
    (databaseUrl.schemaWasExplicit && containsDemoTargetToken(databaseUrl.schema));
  if (!dedicatedDemoTarget) {
    throw new Error("Demo seed refused. Shared-demo mode requires a database or explicit schema with a demo token.");
  }
}

export function authorizeDemoSeedEnvironment(env: TestDatabaseEnvironment): DemoSeedAuthorization {
  const testMutationOptIn = env.ALLOW_TEST_DATABASE_MUTATIONS === "1";
  const sharedDemoConfirmed = env.ALLOW_SHARED_DEMO_SEED === SHARED_DEMO_SEED_CONFIRMATION;

  if (testMutationOptIn && sharedDemoConfirmed) {
    throw new Error("Demo seed refused. Test-only and shared-demo authorization modes are mutually exclusive.");
  }

  if (testMutationOptIn) {
    assertTestDatabaseSafety(env);
    return { clearBackupAudits: true };
  }

  if (sharedDemoConfirmed) {
    if (isCi(env)) {
      throw new Error("Demo seed refused. Shared-demo seeding is disabled in CI.");
    }
    assertSharedDemoTarget(env);
    return { clearBackupAudits: false };
  }

  throw new Error(
    "Demo seed refused. Use explicit isolated-test authorization or the exact shared-demo confirmation outside CI.",
  );
}
