import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { testSchemas, testDatabases, inspectDatabase } from './neon-retention-inventory.mjs';
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function eligibleResource(database, resource, archive, config) {
  const named = database.identity.datname === 'neondb' ? testSchemas.includes(resource.schema) : testDatabases.includes(database.identity.datname);
  return named && !database.sessions.length && !!archive?.verified && !!config?.references?.length && config.localEnvReferences === 0 && config.references.every(r => !r.referencedCandidates.length)
    && resource.accounts.every(a => a.ibkrAccount === 'DEMO-WORKSTATION')
    && resource.dependencies.every(d => [null, resource.schema, 'pg_catalog'].includes(d.dependent_schema) && [null, resource.schema, 'pg_catalog'].includes(d.referenced_schema) && (d.dependent_schema !== null || d.dependent_type === 'default value'));
}
/** Caller supplies an inspected resource. No CASCADE: a new outside dependency rolls everything back. */
export async function removeVerifiedSchema(db, resource) {
  if (!testSchemas.includes(resource.schema)) throw Error('Schema is not in the exact cleanup allowlist');
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout='1s'");
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
    const namespace = (await tx.$queryRawUnsafe('SELECT oid::text,nspowner::text FROM pg_namespace WHERE nspname=$1', resource.schema))[0];
    if (JSON.stringify(namespace) !== JSON.stringify(resource.namespace)) throw Error('Schema identity changed');
    if (resource.relations.some(r => !['r','p'].includes(r.relkind))) throw Error('Non-table relation requires separate review');
    const names = resource.tables.map(t => `${quote(resource.schema)}.${quote(t.relname)}`);
    if (names.length) await tx.$executeRawUnsafe(`LOCK TABLE ${names.join(',')} IN ACCESS EXCLUSIVE MODE NOWAIT`);
    const relations = await tx.$queryRawUnsafe(`SELECT c.oid::text,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.relname`, resource.schema);
    if (JSON.stringify(relations) !== JSON.stringify(resource.relations.map(({oid,relname,relkind})=>({oid,relname,relkind})))) throw Error('Schema contents changed');
    for (const table of resource.tables) {
      const row = (await tx.$queryRawUnsafe(`SELECT count(*)::text AS rows, md5(COALESCE(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${quote(resource.schema)}.${quote(table.relname)} t`))[0];
      if (row.rows !== table.rows || row.fingerprint !== table.fingerprint) throw Error('Schema data changed');
    }
    // RESTRICT protects newly introduced views/FKs outside this exact set of tables.
    if (names.length) await tx.$executeRawUnsafe(`DROP TABLE ${names.join(',')} RESTRICT`);
    const enums = await tx.$queryRawUnsafe('SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname=$1 AND typtype=\'e\' ORDER BY typname', resource.schema);
    for (const e of enums) await tx.$executeRawUnsafe(`DROP TYPE ${quote(resource.schema)}.${quote(e.typname)} RESTRICT`);
    await tx.$executeRawUnsafe(`DROP SCHEMA ${quote(resource.schema)} RESTRICT`);
  }, { timeout: 120000 });
}
export async function cleanup(connection, manifest, archives, config, evidencePath) {
  const url = new URL(connection);
  if (url.pathname !== '/neondb' || hash({ host: url.hostname, port: url.port || '5432' }) !== manifest.serverIdentity) throw Error('Server/database identity does not match inspected manifest');
  if (Date.now() - Date.parse(config.checkedAt) > 86400_000) throw Error('Refresh configuration references before cleanup');
  for (const archive of archives) if (!archive.verified || digest(await fs.readFile(archive.dump)) !== archive.sha256) throw Error('Archive missing, changed or not restore-tested');
  const results = [];
  const db = new PrismaClient({ datasourceUrl: connection, log: [] });
  const record = async result => { results.push(result); await fs.writeFile(evidencePath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2)); console.log(JSON.stringify(result)); };
  try {
    for (const database of manifest.databases) {
      const archive = archives.find(a => a.database === database.identity.datname);
      if (database.identity.datname === 'neondb') {
        for (const resource of database.resources.filter(r => r.schema !== 'public')) {
          if (!eligibleResource(database, resource, archive, config)) { await record({ schema: resource.schema, skipped: 'Not eligible' }); continue; }
          try {
            const active = await db.$queryRawUnsafe(`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`);
            if (active.length) throw Error('Active connections; resource left untouched');
            await removeVerifiedSchema(db, resource);
            await record({ schema: resource.schema, removed: true });
          } catch { await record({ schema: resource.schema, skipped: 'Active, changed or dependent; transaction rolled back' }); }
        }
      } else {
        if (!database.resources.every(r => eligibleResource(database, r, archive, config))) { await record({ database: database.identity.datname, skipped: 'Not eligible' }); continue; }
        let paused = false;
        const target = new URL(connection); target.pathname = '/' + database.identity.datname;
        const inspection = new PrismaClient({ datasourceUrl: target.href, log: [] });
        try {
          await inspection.$connect();
          // Prevent a new connection in the check/drop gap; never terminate existing sessions.
          await db.$executeRawUnsafe(`ALTER DATABASE ${quote(database.identity.datname)} ALLOW_CONNECTIONS false`); paused = true;
          const fresh = await inspectDatabase(connection, database.identity.datname, inspection);
          if (fresh.sessions.length || fresh.identity.oid !== database.identity.oid || fresh.identity.owner !== database.identity.owner || hash(fresh.resources.map(r=>r.fingerprint)) !== hash(database.resources.map(r=>r.fingerprint))) throw Error('Database is active or changed');
          await inspection.$disconnect();
          const active = await db.$queryRawUnsafe('SELECT pid FROM pg_stat_activity WHERE datname=$1', database.identity.datname);
          if (active.length) throw Error('A connection arrived; skip database');
          await db.$executeRawUnsafe(`DROP DATABASE ${quote(database.identity.datname)}`); paused = false;
          await record({ database: database.identity.datname, removed: true });
        } catch { await record({ database: database.identity.datname, skipped: 'Active, changed or dependent; database preserved' }); }
        finally { await inspection.$disconnect(); if (paused) await db.$executeRawUnsafe(`ALTER DATABASE ${quote(database.identity.datname)} ALLOW_CONNECTIONS true`); }
      }
    }
  } finally { await db.$disconnect(); }
  return results;
}
