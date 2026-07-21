#!/usr/bin/env node
import path from "node:path";

function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    json: false,
    approvedRefs: [],
    identityScope: "undecided",
    signatureScope: "undecided",
  };
  let explicitRefs = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
    } else if (argument === "--root" && argv[index + 1]) {
      options.root = path.resolve(argv[++index]);
    } else if (argument === "--ref" && argv[index + 1]) {
      explicitRefs = true;
      options.approvedRefs.push(argv[++index]);
    } else if (argument === "--identity-scope" && ["preserve", "rewrite"].includes(argv[index + 1])) {
      options.identityScope = argv[++index];
    } else if (argument === "--signature-scope" && ["strip", "abort-on-signed"].includes(argv[index + 1])) {
      options.signatureScope = argv[++index];
    } else if (argument === "--help") {
      process.stdout.write(
        "Usage: node scripts/repository-safety/history-cli.mjs [--root PATH] [--ref REF] [--json] [--identity-scope preserve|rewrite] [--signature-scope strip|abort-on-signed]\n",
      );
      process.exit(0);
    } else {
      throw new Error("Unsupported repository history scanner argument.");
    }
  }
  if (!explicitRefs) delete options.approvedRefs;
  return options;
}

let scannerModule;
try {
  scannerModule = await import("./history-scanner.mjs");
  const options = parseArguments(process.argv.slice(2));
  const result = scannerModule.scanHistoryRepository(options.root, options);
  process.stdout.write(`${options.json ? JSON.stringify(result) : scannerModule.formatHistoryTextReport(result)}\n`);
  if (result.findingCount > 0 || !result.ownerDecisions.rewriteAllowed) process.exitCode = 1;
} catch (error) {
  const code =
    scannerModule && error instanceof scannerModule.HistoryScanOperationalError
      ? error.code
      : "SCANNER_BOOTSTRAP_FAILED";
  process.stderr.write(
    `Repository history safety scan could not complete (${code}). No matched values, object IDs, identities, or repository paths were printed.\n`,
  );
  process.exitCode = 2;
}
