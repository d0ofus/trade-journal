#!/usr/bin/env node
import path from "node:path";

function parseArguments(argv) {
  const options = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (argument === "--root" && argv[index + 1]) {
      options.root = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument === "--help") {
      process.stdout.write("Usage: node scripts/repository-safety/cli.mjs [--root PATH] [--json]\n");
      process.exit(0);
    }
    throw new Error("Unsupported repository safety scanner argument.");
  }
  return options;
}

try {
  const { formatTextReport, redactResult, scanRepository } = await import("./scanner.mjs");
  const options = parseArguments(process.argv.slice(2));
  const result = scanRepository(options.root);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ ok: result.findings.length === 0, ...redactResult(result) })}\n`);
  } else {
    process.stdout.write(`${formatTextReport(result)}\n`);
  }
  if (result.findings.length > 0) process.exitCode = 1;
} catch {
  process.stderr.write("Repository safety scan could not complete. No matched values were printed.\n");
  process.exitCode = 2;
}
