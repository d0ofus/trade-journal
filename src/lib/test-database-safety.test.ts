import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertLoopbackBaseUrl,
  assertTestDatabaseSafety,
  containsTestTargetToken,
  loadDotEnvWithoutOverride,
  parsePostgresTarget,
} from "@/lib/test-database-safety";

const SAFE_DATABASE_URL = "postgresql://user:password@db.example:5432/trade_journal_test?schema=public";

function safeEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    ALLOW_TEST_DATABASE_MUTATIONS: "1",
    DATABASE_URL: SAFE_DATABASE_URL,
    DIRECT_URL: SAFE_DATABASE_URL,
    ...overrides,
  };
}

describe("test database target parsing", () => {
  it("normalizes equivalent PostgreSQL protocols, hosts, ports, and default schemas", () => {
    expect(parsePostgresTarget("postgres://user@DB.EXAMPLE/trade_test", "DATABASE_URL")).toEqual({
      database: "trade_test",
      host: "db.example:5432",
      schema: "public",
      schemaWasExplicit: false,
    });
  });

  it.each(["trade_test", "trade-e2e-01", "CI", "test.trade"])(
    "recognizes %s as a test-only target name",
    (name) => {
      expect(containsTestTargetToken(name)).toBe(true);
    },
  );

  it.each(["contest", "latest", "citrine", "production"])(
    "does not accept token substrings in %s",
    (name) => {
      expect(containsTestTargetToken(name)).toBe(false);
    },
  );

  it("rejects malformed, non-PostgreSQL, and database-less URLs without echoing them", () => {
    const invalidUrls = [
      "not-a-url-with-a-secret",
      "mysql://user:secret@db.example/trade_test",
      "postgresql://user:secret@db.example",
    ];

    for (const invalidUrl of invalidUrls) {
      expect(() => parsePostgresTarget(invalidUrl, "DATABASE_URL")).toThrowError();

      try {
        parsePostgresTarget(invalidUrl, "DATABASE_URL");
      } catch (error) {
        expect((error as Error).message).not.toContain(invalidUrl);
        expect((error as Error).message).not.toContain("secret");
      }
    }
  });
});

describe("test database safety validation", () => {
  it("accepts matching URLs when the database name has a test token", () => {
    expect(assertTestDatabaseSafety(safeEnvironment())).toMatchObject({
      databaseUrl: { database: "trade_journal_test", schema: "public" },
      directUrl: { database: "trade_journal_test", schema: "public" },
    });
  });

  it("accepts an explicit test schema on an otherwise non-test database", () => {
    const url = "postgresql://user:password@db.example/trade_journal?schema=run_e2e";
    expect(
      assertTestDatabaseSafety(safeEnvironment({ DATABASE_URL: url, DIRECT_URL: url })),
    ).toMatchObject({ databaseUrl: { database: "trade_journal", schema: "run_e2e" } });
  });

  it("requires the mutation opt-in and both URLs", () => {
    expect(() =>
      assertTestDatabaseSafety(safeEnvironment({ ALLOW_TEST_DATABASE_MUTATIONS: "0" })),
    ).toThrow("ALLOW_TEST_DATABASE_MUTATIONS");
    expect(() => assertTestDatabaseSafety(safeEnvironment({ DATABASE_URL: undefined }))).toThrow(
      "DATABASE_URL is required",
    );
    expect(() => assertTestDatabaseSafety(safeEnvironment({ DIRECT_URL: undefined }))).toThrow(
      "DIRECT_URL is required",
    );
  });

  it("rejects production-like database and schema names", () => {
    const url = "postgresql://user:password@db.example/trade_journal?schema=public";
    expect(() =>
      assertTestDatabaseSafety(safeEnvironment({ DATABASE_URL: url, DIRECT_URL: url })),
    ).toThrow("test, e2e, or ci token");
  });

  it.each([
    [
      "host",
      "postgresql://user:password@other.example/trade_journal_test?schema=public",
    ],
    ["database", "postgresql://user:password@db.example/other_test?schema=public"],
    ["schema", "postgresql://user:password@db.example/trade_journal_test?schema=other_test"],
  ])("rejects a mismatched %s", (_field, directUrl) => {
    expect(() => assertTestDatabaseSafety(safeEnvironment({ DIRECT_URL: directUrl }))).toThrow(
      "same PostgreSQL host, database, and schema",
    );
  });

  it("does not include connection values in validation errors", () => {
    const databaseUrl = "postgresql://private-user:private-pass@private.example/production";
    expect(() =>
      assertTestDatabaseSafety(safeEnvironment({ DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl })),
    ).toThrowError();

    try {
      assertTestDatabaseSafety(safeEnvironment({ DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl }));
    } catch (error) {
      expect((error as Error).message).not.toContain(databaseUrl);
      expect((error as Error).message).not.toContain("private-pass");
      expect((error as Error).message).not.toContain("private.example");
    }
  });
});

describe("environment loading", () => {
  it("loads .env values without overriding explicit process variables", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "trade-journal-env-"));
    const envFile = path.join(directory, ".env");
    const explicitKey = "TEST_DATABASE_SAFETY_EXPLICIT";
    const loadedKey = "TEST_DATABASE_SAFETY_LOADED";
    const previousExplicit = process.env[explicitKey];
    const previousLoaded = process.env[loadedKey];

    try {
      process.env[explicitKey] = "from-process";
      delete process.env[loadedKey];
      writeFileSync(envFile, `${explicitKey}=from-file\n${loadedKey}=from-file\n`, "utf8");

      loadDotEnvWithoutOverride(envFile);

      expect(process.env[explicitKey]).toBe("from-process");
      expect(process.env[loadedKey]).toBe("from-file");
    } finally {
      if (previousExplicit === undefined) delete process.env[explicitKey];
      else process.env[explicitKey] = previousExplicit;
      if (previousLoaded === undefined) delete process.env[loadedKey];
      else process.env[loadedKey] = previousLoaded;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("Playwright base URL safety", () => {
  it.each([
    "http://localhost:3100",
    "https://127.0.0.1:3100",
    "http://127.20.30.40:3100",
    "http://[::1]:3100",
  ])("accepts loopback URL %s", (url) => {
    expect(() => assertLoopbackBaseUrl(url)).not.toThrow();
  });

  it.each([
    "https://example.com",
    "http://10.0.0.2:3100",
    "http://0.0.0.0:3100",
    "file://localhost/tmp/test",
    "not-a-url",
  ])("rejects non-loopback or invalid URL %s", (url) => {
    expect(() => assertLoopbackBaseUrl(url)).toThrowError();
  });
});
