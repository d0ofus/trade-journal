import {
  assertLoopbackBaseUrl,
  assertTestDatabaseSafety,
  loadDotEnvWithoutOverride,
  TestDatabaseSafetyError,
} from "../src/lib/test-database-safety";

loadDotEnvWithoutOverride();

try {
  assertTestDatabaseSafety(process.env);

  if (process.argv.includes("--playwright")) {
    const e2ePort = process.env.PLAYWRIGHT_PORT ?? "3100";
    const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${e2ePort}`;
    assertLoopbackBaseUrl(baseURL);
  }
} catch (error) {
  const message =
    error instanceof TestDatabaseSafetyError ? error.message : "Test database safety check failed.";
  console.error(message);
  process.exitCode = 1;
}
