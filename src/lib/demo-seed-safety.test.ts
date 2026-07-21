import { authorizeDemoSeedEnvironment, SHARED_DEMO_SEED_CONFIRMATION } from "@/lib/demo-seed-safety";

function isolatedEnvironment(overrides: Record<string, string | undefined> = {}) {
  const databaseUrl = "postgresql://user:password@db.example/trades?schema=trade_journal_phase16_test";
  return {
    ALLOW_TEST_DATABASE_MUTATIONS: "1",
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    ...overrides,
  };
}

function sharedDemoEnvironment(overrides: Record<string, string | undefined> = {}) {
  const databaseUrl = "postgresql://user:password@db.example/trades?schema=trade_journal_demo";
  return {
    ALLOW_SHARED_DEMO_SEED: SHARED_DEMO_SEED_CONFIRMATION,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    ...overrides,
  };
}

describe("authorizeDemoSeedEnvironment", () => {
  it("authorizes only a validated isolated test target in test mode", () => {
    expect(authorizeDemoSeedEnvironment(isolatedEnvironment())).toEqual({ clearBackupAudits: true });
  });

  it("fails closed when test and shared-demo modes are both enabled", () => {
    expect(() =>
      authorizeDemoSeedEnvironment(
        isolatedEnvironment({ ALLOW_SHARED_DEMO_SEED: SHARED_DEMO_SEED_CONFIRMATION }),
      ),
    ).toThrow("mutually exclusive");
  });

  it("does not fall through to shared mode after test database validation fails", () => {
    expect(() =>
      authorizeDemoSeedEnvironment({
        ...isolatedEnvironment({ DATABASE_URL: "postgresql://user:password@db.example/trades?schema=public" }),
        ALLOW_SHARED_DEMO_SEED: SHARED_DEMO_SEED_CONFIRMATION,
      }),
    ).toThrow("mutually exclusive");
  });

  it("allows explicit shared-demo mode only outside CI", () => {
    expect(authorizeDemoSeedEnvironment(sharedDemoEnvironment())).toEqual({ clearBackupAudits: false });
    expect(() =>
      authorizeDemoSeedEnvironment(sharedDemoEnvironment({ CI: "true" })),
    ).toThrow("disabled in CI");
  });

  it("requires shared-demo mode to target one dedicated demo database or schema", () => {
    expect(() =>
      authorizeDemoSeedEnvironment({ ALLOW_SHARED_DEMO_SEED: SHARED_DEMO_SEED_CONFIRMATION }),
    ).toThrow("requires both database URLs");
    expect(() =>
      authorizeDemoSeedEnvironment(
        sharedDemoEnvironment({
          DATABASE_URL: "postgresql://user:password@db.example/trades?schema=public",
          DIRECT_URL: "postgresql://user:password@db.example/trades?schema=public",
        }),
      ),
    ).toThrow("demo token");
  });

  it("requires shared-demo URLs to resolve to the same host, database, and schema", () => {
    const mismatchedDirectUrls = [
      "postgresql://user:password@other.example/trades?schema=trade_journal_demo",
      "postgresql://user:password@db.example/trades_demo_other?schema=trade_journal_demo",
      "postgresql://user:password@db.example/trades?schema=trade_journal_demo_other",
    ];

    for (const directUrl of mismatchedDirectUrls) {
      expect(() => authorizeDemoSeedEnvironment(sharedDemoEnvironment({ DIRECT_URL: directUrl }))).toThrow(
        "same target",
      );
    }
  });

  it("rejects missing authorization", () => {
    expect(() => authorizeDemoSeedEnvironment({})).toThrow("Demo seed refused");
  });
});
