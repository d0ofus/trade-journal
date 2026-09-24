import { spawnSync } from "node:child_process";

function run(module, args) {
  const result = spawnSync(process.execPath, [module, ...args], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Apply committed migrations before Vercel promotes a production build. Preview
// builds never migrate the production database. Prisma serializes migrations.
if (process.env.VERCEL_ENV === "production") {
  if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) throw new Error("Production migrations require DATABASE_URL and DIRECT_URL.");
  run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
}
run("scripts/repository-safety/cli.mjs", process.env.VERCEL === "1" ? ["--deployment-tree"] : []);
run("node_modules/next/dist/bin/next", ["build"]);
