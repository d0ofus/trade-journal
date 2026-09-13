import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
export function pgEnvironment(connection) {
  const url = new URL(connection);
  return { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: ['localhost','127.0.0.1','[::1]'].includes(url.hostname) ? 'disable' : 'require', PGCONNECT_TIMEOUT: '30', PGOPTIONS: '' };
}
export async function archiveAndRestore(connection, manifest, directory, bin, localConnection) {
  const local = new URL(localConnection);
  if (local.hostname !== '127.0.0.1' || local.pathname !== '/postgres') throw Error('Restore validation requires explicit local PostgreSQL administration connection');
  const root = path.resolve(directory);
  if (root.startsWith(path.resolve(process.cwd()) + path.sep)) throw Error('Backups must be outside the repository');
  await fs.mkdir(root, { recursive: true });
  const run = (exe, args, env) => {
    const result = spawnSync(path.join(bin, exe + (process.platform === 'win32' ? '.exe' : '')), args, { env, encoding: 'utf8', timeout: 600000 });
    if (result.status !== 0) { writeFileSync(path.join(root, `retention-${exe}-error.log`), result.stderr ?? 'Tool failed'); throw Error(`${exe} failed; archive/restore was not verified`); }
  };
  const admin = new PrismaClient({ datasourceUrl: localConnection, log: [] });
  const archives = [];
  try {
    for (const [index, database] of manifest.databases.entries()) {
      const target = new URL(connection); target.pathname = '/' + database.identity.datname;
      // Resume archive verification without downloading the same snapshot again.
      // Every restored row must still match the inspected manifest below.
      const previous = (await fs.readdir(root)).filter(name => name.startsWith(database.identity.datname + '-') && /-\d+\.dump$/.test(name)).sort().at(-1);
      const dump = path.join(root, previous ?? `${database.identity.datname}-${Date.now()}.dump`);
      if (!previous) run('pg_dump', ['--format=custom', '--no-owner', '--no-acl', ...database.resources.flatMap(r => ['--schema', r.schema]), '--file', dump], { ...pgEnvironment(target.href), PGOPTIONS: '-c default_transaction_read_only=on' });
      const sha256 = checksum(await fs.readFile(dump));
      const localName = `retention_restore_test_${Date.now()}_${index}`;
      await admin.$executeRawUnsafe(`CREATE DATABASE ${quote(localName)}`);
      const restored = new URL(localConnection); restored.pathname = '/' + localName;
      const client = new PrismaClient({ datasourceUrl: restored.href, log: [] });
      let compared = 0;
      try {
        // Only the brand-new isolated restore database; RESTRICT refuses non-empty schemas.
        await client.$executeRawUnsafe('DROP SCHEMA public RESTRICT');
        run('pg_restore', ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', localName, dump], pgEnvironment(restored.href));
        await client.$executeRawUnsafe("SET TIME ZONE 'UTC'");
        for (const resource of database.resources) for (const table of resource.tables) {
          const row = (await client.$queryRawUnsafe(`SELECT count(*)::text AS rows, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${quote(resource.schema)}.${quote(table.relname)} t`))[0];
          if (row.rows !== table.rows || row.fingerprint !== table.fingerprint) throw Error(`Archive differs from manifest in ${resource.schema}.${table.relname}; preserve resources`);
          compared++;
        }
      } finally { await client.$disconnect(); }
      const archive = { database: database.identity.datname, dump, sha256, bytes: (await fs.stat(dump)).size, restoredDatabase: localName, comparedTables: compared, restoredAt: new Date().toISOString(), verified: true };
      archives.push(archive);
      await fs.writeFile(path.join(root, 'retention-archives.json'), JSON.stringify(archives, null, 2));
      console.log(JSON.stringify({ archived: database.identity.datname, comparedTables: compared, bytes: archive.bytes, localRestoreVerified: true }));
      await admin.$executeRawUnsafe(`DROP DATABASE ${quote(localName)}`);
    }
    return archives;
  } finally { await admin.$disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(await fs.readFile(process.env.RETENTION_MANIFEST_PATH, 'utf8'));
    await archiveAndRestore(process.env.MAINTENANCE_DATABASE_URL, manifest, process.env.RETENTION_BACKUP_DIRECTORY, process.env.POSTGRES_BIN, process.env.LOCAL_RESTORE_DATABASE_URL);
  } catch { console.error('Archive verification failed. No remote resources were removed.'); process.exitCode = 1; }
}
