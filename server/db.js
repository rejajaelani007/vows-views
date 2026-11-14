import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrateDatabase } from './migrations.js';
import { StartupError } from './startup-error.js';

// Route helper queries to the current transaction. Queue local operations so
// other requests cannot read or write another request's uncommitted changes.
export function databaseAdapter(client, remote = false) {
  const context = new AsyncLocalStorage();
  let queue = Promise.resolve();
  async function exclusive(fn) {
    const previous = queue;
    let release;
    queue = new Promise((done) => {
      release = done;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  function execute(sql, args, method) {
    const run = async (connection) => {
      if (!remote) return connection.prepare(sql)[method](...args);
      const result = await connection.execute({ sql, args });
      if (method === 'get') return result.rows[0];
      if (method === 'all') return result.rows;
      return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
    };
    const current = context.getStore();
    return current ? run(current) : exclusive(() => run(client));
  }
  return {
    remote,
    prepare(sql) {
      return Object.fromEntries(
        ['get', 'all', 'run'].map((method) => [method, (...args) => execute(sql, args, method)]),
      );
    },
    exec: (sql) => exclusive(() => (remote ? client.executeMultiple(sql) : client.exec(sql))),
    async transaction(fn) {
      if (context.getStore()) throw new Error('Nested transactions are not supported.');
      return exclusive(async () => {
        const connection = remote ? await client.transaction('write') : client;
        if (!remote) client.exec('BEGIN IMMEDIATE');
        try {
          const result = await context.run(connection, fn);
          if (remote) {
            try {
              await connection.commit();
            } catch (error) {
              error.commitUncertain = true;
              throw error;
            }
          } else client.exec('COMMIT');
          return result;
        } catch (error) {
          try {
            if (remote) await connection.rollback();
            else client.exec('ROLLBACK');
          } catch {
            /* The provider may already have rolled back an expired transaction. */
          }
          throw error;
        } finally {
          if (remote) connection.close();
        }
      });
    },
    close: () => client.close(),
  };
}

export async function openDatabase(
  dataDir,
  {
    url = process.env.TURSO_DATABASE_URL,
    authToken = process.env.TURSO_AUTH_TOKEN,
    initialize,
    serverless = process.env.VERCEL === '1',
  } = {},
) {
  url = url?.trim();
  authToken = authToken?.trim();
  initialize ??= !url;
  let client;
  if (url) {
    if (!/^(libsql|https):\/\//.test(url) || !authToken)
      throw new StartupError(
        'CONFIG_INVALID_DATABASE',
        'Isi TURSO_DATABASE_URL (libsql:// atau https://) dan TURSO_AUTH_TOKEN yang valid.',
      );
    const { createClient } = await import('@libsql/client/web');
    client = createClient({ url, authToken, intMode: 'number' });
  } else {
    if (serverless)
      throw new Error('Vercel memerlukan database Turso; SQLite lokal tidak persisten.');
    const { DatabaseSync } = await import('node:sqlite');
    mkdirSync(dataDir, { recursive: true });
    client = new DatabaseSync(resolve(dataDir, 'wedding.sqlite'));
  }
  const db = databaseAdapter(client, Boolean(url));
  try {
    if (initialize) {
      let schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
      if (url) schema = schema.replace(/^PRAGMA .*;\r?\n/gm, '');
      await db.exec(schema);
      await migrateDatabase(db);
    }
    if (url && (await db.prepare('PRAGMA foreign_keys').get()).foreign_keys !== 1)
      throw new StartupError(
        'DATABASE_FOREIGN_KEYS_DISABLED',
        'Database libSQL harus mengaktifkan foreign_keys secara default.',
        'database',
      );
    await db.prepare('SELECT id FROM settings WHERE id=1').get();
    await db.prepare('SELECT message FROM photos LIMIT 0').all();
    await db
      .prepare(
        'SELECT q.project_id, p.filters_json, a.role FROM qr_codes q JOIN projects p ON p.id=q.project_id JOIN admins a ON a.id=p.owner_id LIMIT 0',
      )
      .all();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export const transaction = (db, fn) => db.transaction(fn);

export async function expireSessions(db) {
  await db
    .prepare("UPDATE guest_sessions SET status='expired' WHERE status='active' AND expires_at<=?")
    .run(new Date().toISOString());
}

export async function allocatedSessions(db, qrId) {
  return (
    await db
      .prepare(
        "SELECT COUNT(*) AS count FROM guest_sessions WHERE qr_id=? AND (status!='expired' OR photo_count>0)",
      )
      .get(qrId)
  ).count;
}

export async function serializeQr(db, qr, publicUrl) {
  const sessions = (
    await db.prepare('SELECT COUNT(*) count FROM guest_sessions WHERE qr_id=?').get(qr.id)
  ).count;
  const allocated = await allocatedSessions(db, qr.id);
  return {
    ...qr,
    active: Boolean(qr.active),
    remaining: qr.total_limit - qr.used_count,
    max_sessions: Math.floor(qr.total_limit / qr.per_session_limit),
    unallocated: qr.total_limit % qr.per_session_limit,
    sessions,
    allocated_sessions: allocated,
    url: `${publicUrl}/${qr.username}/${qr.code}`,
    legacy_url: qr.project_id === 'legacy' ? `${publicUrl}/camera/${qr.code}` : undefined,
  };
}
