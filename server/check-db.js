import { openDatabase } from './db.js';
import { loadEnvironment } from './runtime.js';
import { StartupError, databaseStartupError, startupDiagnostic } from './startup-error.js';

loadEnvironment();
let db;
try {
  const missing = ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN'].filter(
    (key) => !process.env[key]?.trim(),
  );
  if (missing.length)
    throw new StartupError(
      'CONFIG_MISSING_ENV',
      `Isi ${missing.join(', ')} di .env lokal dengan konfigurasi database Turso deployment Anda.`,
    );
  // Explicitly disable initialization: this command cannot create tables or
  // modify photos/settings. It never falls back to a local SQLite database.
  db = await openDatabase(undefined, { initialize: false, serverless: true });
  for (const table of [
    'admins',
    'admin_sessions',
    'qr_codes',
    'guest_sessions',
    'photos',
    'settings',
    'rate_limits',
  ]) {
    await db.prepare(`SELECT 1 FROM ${table} LIMIT 0`).all();
  }
  const admin = await db.prepare('SELECT id FROM admins LIMIT 1').get();
  console.log(
    'DATABASE_READY: Koneksi Turso, tabel aplikasi, dan kolom pesan siap. Tidak ada data yang diubah.',
  );
  if (!admin)
    console.log(
      'ADMIN_NOT_CREATED: Jalankan npm run admin:create untuk membuat akun admin pertama.',
    );
} catch (error) {
  const diagnostic = startupDiagnostic(databaseStartupError(error));
  console.error(`${diagnostic.code}: ${diagnostic.message}`);
  if (diagnostic.providerCode) console.error(`Provider code: ${diagnostic.providerCode}`);
  process.exitCode = 1;
} finally {
  db?.close();
}
