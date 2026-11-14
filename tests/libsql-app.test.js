import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('complete API suite also passes with the asynchronous libSQL client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wedding-libsql-suite-'));
  try {
    // Process isolation ensures native Windows mappings are released before
    // deleting the fixture files; no GC tricks or arbitrary cleanup sleeps.
    const env = { ...process.env, WEDDING_TEST_LIBSQL: '1', WEDDING_TEST_ROOT: directory };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(
      process.execPath,
      ['--experimental-sqlite', '--test', 'tests/app.test.js'],
      {
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const code = await new Promise((done, reject) => {
      child.on('error', reject);
      child.on('close', done);
    });
    assert.equal(code, 0, output);
    assert.match(output, /# fail 0/);
    assert.match(output, /# skipped 0/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
