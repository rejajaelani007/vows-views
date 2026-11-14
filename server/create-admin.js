import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { openDatabase } from './db.js';
import { createAdmin } from './security.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const email = process.env.ADMIN_EMAIL || (await rl.question('Email admin: '));
  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    process.stdout.write('Password (minimal 12 karakter, input disembunyikan): ');
    rl._writeToOutput = () => {};
    password = await rl.question('');
    process.stdout.write('\n');
  }
  const db = await openDatabase(resolve(process.env.DATA_DIR || './data'));
  try {
    await createAdmin(db, email.trim(), password);
    console.log('Akun admin berhasil dibuat.');
  } finally {
    db.close();
  }
} catch (error) {
  console.error(
    error.code?.includes('CONSTRAINT') ? 'Email admin sudah terdaftar.' : error.message,
  );
  process.exitCode = 1;
} finally {
  rl.close();
}
