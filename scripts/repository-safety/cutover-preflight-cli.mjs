#!/usr/bin/env node

import path from "node:path";

function parseArguments(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--ledger" && argv[index + 1]) {
      options.ledgerPath = path.resolve(argv[++index]);
    } else if (argument === "--ledger-sha256" && argv[index + 1]) {
      options.expectedLedgerSha256 = argv[++index].toLowerCase();
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/repository-safety/cutover-preflight-cli.mjs --ledger PATH --ledger-sha256 SHA256 [--json]\n",
      );
      process.exit(0);
    } else {
      throw new Error("UNSUPPORTED_ARGUMENT");
    }
  }
  if (!options.ledgerPath || !options.expectedLedgerSha256) throw new Error("LEDGER_ARGUMENTS_REQUIRED");
  if (!/^[0-9a-f]{64}$/.test(options.expectedLedgerSha256)) throw new Error("LEDGER_DIGEST_INVALID");
  return options;
}

let preflightModule;
try {
  preflightModule = await import("./cutover-preflight.mjs");
  const options = parseArguments(process.argv.slice(2));
  const result = preflightModule.runCutoverPreflight(options);
  process.stdout.write(
    `${options.json ? JSON.stringify(result) : preflightModule.formatCutoverPreflightReport(result)}\n`,
  );
  if (result.status !== "READY") process.exitCode = 1;
} catch (error) {
  const code =
    preflightModule && error instanceof preflightModule.CutoverPreflightOperationalError
      ? error.code
      : "PREFLIGHT_BOOTSTRAP_FAILED";
  process.stderr.write(
    `Cutover preflight could not complete (${code}). No repository paths, refs, object IDs, identities, remote URLs, or approval values were printed.\n`,
  );
  process.exitCode = 2;
}
