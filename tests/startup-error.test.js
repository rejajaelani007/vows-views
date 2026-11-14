import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseStartupError, startupDiagnostic, StartupError } from '../server/startup-error.js';
import { createStorage } from '../server/storage.js';

test('database startup distinguishes schema, authentication and connection failures without leaking provider text', () => {
  const cases = [
    ['SQLITE_UNKNOWN', 'SQLite error: no such table: settings', 'DATABASE_SCHEMA_NOT_READY'],
    ['SQLITE_UNKNOWN', 'SQLite error: no such column: message', 'DATABASE_SCHEMA_NOT_READY'],
    ['SQLITE_ERROR', 'no such table: settings', 'DATABASE_SCHEMA_NOT_READY'],
    ['SQLITE_ERROR', 'no such column: message', 'DATABASE_SCHEMA_NOT_READY'],
    ['AUTH_FAILED', 'invalid token', 'DATABASE_AUTH_FAILED'],
    ['SERVER_ERROR', 'Server returned HTTP status 401', 'DATABASE_AUTH_FAILED'],
    ['FETCH_FAILED', 'fetch failed', 'DATABASE_CONNECTION_FAILED'],
  ];
  for (const [code, message, expected] of cases) {
    const error = Object.assign(
      new Error(`${message} secret-test-token https://private.turso.io`),
      { code },
    );
    const diagnostic = startupDiagnostic(databaseStartupError(error));
    assert.equal(diagnostic.code, expected);
    assert.equal(diagnostic.stage, 'database');
    assert.equal(diagnostic.providerCode, code);
    assert.doesNotMatch(JSON.stringify(diagnostic), /secret-test-token|private\.turso\.io/);
  }
  const known = new StartupError(
    'DATABASE_FOREIGN_KEYS_DISABLED',
    'Database foreign keys are disabled.',
    'database',
  );
  assert.equal(databaseStartupError(known), known);
  const unknown = startupDiagnostic(new Error('Do not disclose this secret'));
  assert.equal(unknown.code, 'SERVICE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(unknown), /disclose|secret/);
});

test('Blob accepts pasted whitespace around provider/token and keeps the token on the server', async () => {
  let received;
  const storage = await createStorage({
    provider: ' vercel-blob\n',
    token: ' fixture-token \n',
    sdk: {
      async put(path, bytes, options) {
        received = options.token;
        return { url: `https://fixture.public.blob.vercel-storage.com/${path}` };
      },
      async del() {},
    },
  });
  const url = await storage.write(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg',
    Buffer.from('fixture'),
  );
  assert.equal(received, 'fixture-token');
  assert.doesNotMatch(url, /fixture-token/);
});
