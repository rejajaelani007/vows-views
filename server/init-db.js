import { resolve } from 'node:path';
import { openDatabase } from './db.js';
import { loadEnvironment } from './runtime.js';

loadEnvironment();
const db = await openDatabase(resolve(process.env.DATA_DIR || './data'), { initialize: true });
try {
  // Expired counters can be purged on subsequent maintenance runs.
  await db.prepare('DELETE FROM rate_limits WHERE reset_time<=?').run(Date.now());
  console.log('Schema database siap. Data yang sudah ada dipertahankan.');
} finally {
  db.close();
}
