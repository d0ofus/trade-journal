// Read-only inventory. Connection supplied explicitly; never loads application .env files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
export const testSchemas = Array.from({ length: 17 }, (_, i) => `trade_journal_phase${i}_test`);
export const testDatabases = ['trade_journal_phase19c_acceptance_test', 'trade_journal_phase19b_cutover_test', 'trade_journal_phase16_test', 'trade_journal_phase19a_test', 'trade_journal_phase18_test', 'trade_journal_phase17_test'];
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';
export async function inspectDatabase(connection, name, existingClient) {
  const url = new URL(connection); url.pathname = '/' + name;
  const db = existingClient ?? new PrismaClient({ datasourceUrl: url.href, log: [] });
  try {
    return await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
      const identity = (await tx.$queryRawUnsafe(`SELECT oid::text,datname,datdba::text AS owner,pg_database_size(oid)::text AS bytes FROM pg_database WHERE datname=current_database()`))[0];
      const sessions = await tx.$queryRawUnsafe(`SELECT pid,usename,application_name,state,backend_start::text FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend' ORDER BY pid`);
      const schemas = name === 'neondb' ? ['public', ...testSchemas] : (await tx.$queryRawUnsafe(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','neon_auth') ORDER BY nspname`)).map(r => r.nspname);
      const resources = [];
      for (const schema of schemas) {
        const namespace = (await tx.$queryRawUnsafe('SELECT oid::text, nspowner::text FROM pg_namespace WHERE nspname=$1', schema))[0];
        if (!namespace) continue;
        const relations = await tx.$queryRawUnsafe(`SELECT c.oid::text,c.relname,c.relkind,pg_total_relation_size(c.oid)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f','S') ORDER BY c.relname`, schema);
        const tables = [];
        for (const relation of relations.filter(r => ['r','p','m'].includes(r.relkind))) {
          const stats = (await tx.$queryRawUnsafe(`SELECT count(*)::text AS rows, md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS fingerprint FROM ${quote(schema)}.${quote(relation.relname)} t`))[0];
          tables.push({ ...relation, ...stats });
        }
        // pg_identify_object supplies namespaces for constraints, triggers and other non-table objects too.
        const dependencies = await tx.$queryRawUnsafe(`SELECT DISTINCT d.deptype, a.type AS dependent_type,a.schema AS dependent_schema,a.identity AS dependent,b.type AS referenced_type,b.schema AS referenced_schema,b.identity AS referenced FROM pg_depend d CROSS JOIN LATERAL pg_identify_object(d.classid,d.objid,d.objsubid) a CROSS JOIN LATERAL pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) b WHERE (a.schema=$1 OR b.schema=$1) AND a.schema IS DISTINCT FROM b.schema AND d.deptype<>'i' ORDER BY dependent,referenced`, schema);
        const accounts = relations.some(r => r.relname === 'Account') ? await tx.$queryRawUnsafe(`SELECT "ibkrAccount" FROM ${quote(schema)}."Account" ORDER BY "ibkrAccount"`) : [];
        resources.push({ schema, namespace, relations, tables, dependencies, accounts, fingerprint: hash({ namespace, tables: tables.map(({oid,relname,relkind,rows,fingerprint}) => ({oid,relname,relkind,rows,fingerprint})), dependencies }), eligible: false, review: null });
      }
      return { identity, sessions, resources };
    }, { isolationLevel: 'RepeatableRead', timeout: 240000 });
  } finally { if (!existingClient) await db.$disconnect(); }
}
export async function inventory(connection) {
  const url = new URL(connection);
  if (url.pathname !== '/neondb') throw Error('Expected the production application database identity');
  const result = { version: 1, capturedAt: new Date().toISOString(), serverIdentity: hash({ host: url.hostname, port: url.port || '5432' }), databases: [] };
  for (const name of ['neondb', ...testDatabases]) result.databases.push(await inspectDatabase(connection, name));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  try {
    if (!process.env.MAINTENANCE_DATABASE_URL || !process.env.RETENTION_MANIFEST_PATH) throw Error('Explicit maintenance connection and external manifest path required');
    const target = path.resolve(process.env.RETENTION_MANIFEST_PATH), repo = path.resolve(process.cwd());
    if (target.startsWith(repo + path.sep)) throw Error('Store private inventory outside the repository');
    const result = await inventory(process.env.MAINTENANCE_DATABASE_URL);
    await fs.writeFile(target, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ manifest: target, databases: result.databases.length, resources: result.databases.reduce((n,d) => n+d.resources.length,0), eligible: 0 }));
  } catch { console.error('Inventory failed; connection and private row details withheld.'); process.exitCode=1; }
}
