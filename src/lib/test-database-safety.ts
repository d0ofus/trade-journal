import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { loadEnvFile } from "node:process";
import path from "node:path";

const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const TEST_TARGET_TOKEN = /(?:^|[^a-z0-9])(?:test|e2e|ci)(?=$|[^a-z0-9])/i;

type DatabaseUrlVariable = "DATABASE_URL" | "DIRECT_URL";

export type TestDatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export interface PostgresTarget {
  database: string;
  host: string;
  schema: string;
  schemaWasExplicit: boolean;
}

export interface TestDatabaseTargets {
  databaseUrl: PostgresTarget;
  directUrl: PostgresTarget;
}

export class TestDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestDatabaseSafetyError";
  }
}

function urlError(variable: DatabaseUrlVariable, detail: string): TestDatabaseSafetyError {
  return new TestDatabaseSafetyError(`${variable} ${detail}`);
}

export function loadDotEnvWithoutOverride(envFile = path.resolve(process.cwd(), ".env")): void {
  if (existsSync(envFile)) {
    loadEnvFile(envFile);
  }
}

export function containsTestTargetToken(value: string): boolean {
  return TEST_TARGET_TOKEN.test(value);
}

export function parsePostgresTarget(value: string, variable: DatabaseUrlVariable): PostgresTarget {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw urlError(variable, "must be a valid PostgreSQL URL.");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw urlError(variable, "must use the postgres or postgresql protocol.");
  }

  if (!parsed.hostname) {
    throw urlError(variable, "must identify a PostgreSQL host.");
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw urlError(variable, "must name a valid PostgreSQL database.");
  }

  if (!database) {
    throw urlError(variable, "must name a PostgreSQL database.");
  }

  const schemas = parsed.searchParams.getAll("schema");
  if (schemas.length > 1 || (schemas.length === 1 && !schemas[0])) {
    throw urlError(variable, "must specify at most one non-empty schema.");
  }

  return {
    database,
    host: `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}`,
    schema: schemas[0] ?? "public",
    schemaWasExplicit: schemas.length === 1,
  };
}

function isTestOnlyTarget(target: PostgresTarget): boolean {
  return (
    containsTestTargetToken(target.database) ||
    (target.schemaWasExplicit && containsTestTargetToken(target.schema))
  );
}

export function assertTestDatabaseSafety(env: TestDatabaseEnvironment): TestDatabaseTargets {
  if (env.ALLOW_TEST_DATABASE_MUTATIONS !== "1") {
    throw new TestDatabaseSafetyError(
      "ALLOW_TEST_DATABASE_MUTATIONS must be set to 1 before database-backed tests can run.",
    );
  }

  if (!env.DATABASE_URL) {
    throw new TestDatabaseSafetyError("DATABASE_URL is required for database-backed tests.");
  }

  if (!env.DIRECT_URL) {
    throw new TestDatabaseSafetyError("DIRECT_URL is required for database-backed tests.");
  }

  const databaseUrl = parsePostgresTarget(env.DATABASE_URL, "DATABASE_URL");
  const directUrl = parsePostgresTarget(env.DIRECT_URL, "DIRECT_URL");

  if (
    databaseUrl.host !== directUrl.host ||
    databaseUrl.database !== directUrl.database ||
    databaseUrl.schema !== directUrl.schema
  ) {
    throw new TestDatabaseSafetyError(
      "DATABASE_URL and DIRECT_URL must resolve to the same PostgreSQL host, database, and schema.",
    );
  }

  if (!isTestOnlyTarget(databaseUrl) || !isTestOnlyTarget(directUrl)) {
    throw new TestDatabaseSafetyError(
      "Database tests require a database name or explicit schema with a test, e2e, or ci token.",
    );
  }

  return { databaseUrl, directUrl };
}

export function assertLoopbackBaseUrl(value: string): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new TestDatabaseSafetyError("PLAYWRIGHT_BASE_URL must be a valid loopback HTTP URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TestDatabaseSafetyError("PLAYWRIGHT_BASE_URL must use HTTP or HTTPS.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const isLoopbackIpv4 = isIP(hostname) === 4 && hostname.split(".")[0] === "127";

  if (hostname !== "localhost" && hostname !== "::1" && !isLoopbackIpv4) {
    throw new TestDatabaseSafetyError("PLAYWRIGHT_BASE_URL must resolve to a loopback host.");
  }
}
