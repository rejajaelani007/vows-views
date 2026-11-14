import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { openDatabase, transaction } from './db.js';
import { createApp } from './app.js';
import { createAdmin } from './security.js';
import { createStorage } from './storage.js';
import { StartupError, databaseStartupError } from './startup-error.js';

export function loadEnvironment() {
  if (process.env.VERCEL !== '1' && existsSync('.env')) process.loadEnvFile('.env');
}

export function runtimeConfig(env = process.env) {
  const value = (key) => (env[key] || '').trim();
  const serverless = env.VERCEL === '1';
  const production = serverless || env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3001);
  const publicUrl = (
    value('PUBLIC_URL') ||
    (serverless && env.VERCEL_URL
      ? `https://${env.VERCEL_URL}`
      : `http://localhost:${process.argv.includes('--development') ? 5173 : port}`)
  ).replace(/\/$/, '');
  let url;
  try {
    url = new URL(publicUrl);
  } catch {
    throw new StartupError(
      'CONFIG_INVALID_PUBLIC_URL',
      'PUBLIC_URL harus origin website yang valid, menggunakan HTTPS untuk production.',
    );
  }
  if (
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (production && url.protocol !== 'https:')
  )
    throw new StartupError(
      'CONFIG_INVALID_PUBLIC_URL',
      'PUBLIC_URL harus origin website, menggunakan HTTPS untuk production.',
    );
  if (serverless) {
    const missing = [
      'TURSO_DATABASE_URL',
      'TURSO_AUTH_TOKEN',
      'STORAGE_PROVIDER',
      'BLOB_READ_WRITE_TOKEN',
    ].filter((key) => !value(key));
    if (missing.length)
      throw new StartupError(
        'CONFIG_MISSING_ENV',
        `Konfigurasi Turso/Blob belum terbaca: ${missing.join(', ')}. Isi pada environment deployment ini dan redeploy.`,
        'configuration',
        { missing },
      );
    if (value('STORAGE_PROVIDER') !== 'vercel-blob')
      throw new StartupError(
        'CONFIG_INVALID_STORAGE_PROVIDER',
        'STORAGE_PROVIDER harus bernilai vercel-blob di Vercel. Perbaiki nilainya dan redeploy.',
      );
  }
  return {
    dataDir: resolve(env.DATA_DIR || './data'),
    publicUrl: url.origin,
    production,
    trustProxy: serverless || env.TRUST_PROXY === '1',
    serveFrontend: !serverless,
    port,
  };
}

export async function startApplication() {
  const config = runtimeConfig();
  let db;
  try {
    db = await openDatabase(config.dataDir);
  } catch (error) {
    throw databaseStartupError(error);
  }
  try {
    // Provision explicitly with admin:create; Vercel cold starts never create
    // an admin. Local installs retain optional env provisioning.
    if (process.env.VERCEL !== '1' && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      await transaction(db, async () => {
        if (!(await db.prepare('SELECT id FROM admins LIMIT 1').get()))
          await createAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
      });
    }
    let storage;
    try {
      storage = await createStorage(config);
    } catch (error) {
      if (error instanceof StartupError) throw error;
      throw new StartupError(
        'STORAGE_INITIALIZATION_FAILED',
        'Penyimpanan foto belum siap. Periksa STORAGE_PROVIDER dan BLOB_READ_WRITE_TOKEN.',
        'storage',
        { cause: error },
      );
    }
    return { app: await createApp({ db, storage, ...config }), db, config };
  } catch (error) {
    db.close();
    throw error;
  }
}
