import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.js';

test('pre-project SQLite records retain ownership, URL code, photo history and both quota counters on repeated startup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'legacy-wedding-'));
  let db;
  try {
    const old = new DatabaseSync(join(dir, 'wedding.sqlite'));
    try {
      const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
      old.exec(schema.split('CREATE TABLE IF NOT EXISTS projects')[0]);
      old.exec(`INSERT INTO admins(id,email,password_hash) VALUES('original','owner@example.org','existing-hash');
       UPDATE settings SET partner_one='Rani',venue='Taman' WHERE id=1;
       INSERT INTO qr_codes(id,code,label,total_limit,per_session_limit,used_count) VALUES('printed','original-printed-code','Undangan',2,2,1);
       INSERT INTO guest_sessions(id,qr_id,token_hash,csrf,photo_limit,photo_count,expires_at) VALUES('s','printed','token','csrf',2,1,'2030-01-01');
       INSERT INTO photos(id,qr_id,session_id,storage_name,thumb_name,original_filename,file_size,width,height,request_key,message)
       VALUES('photo','printed','s','old.jpg','old-thumb.jpg','upload.jpg',1000,640,480,'original-key','Selamat!');`);
    } finally {
      old.close();
    }
    for (let i = 0; i < 2; i++) {
      db = await openDatabase(dir, { url: '', serverless: false });
      const row = await db
        .prepare(
          `SELECT p.owner_id,q.project_id,q.code,q.used_count,s.photo_count,f.message,f.storage_name,a.role,a.password_hash
       FROM photos f JOIN guest_sessions s ON s.id=f.session_id JOIN qr_codes q ON q.id=f.qr_id
       JOIN projects p ON p.id=q.project_id JOIN admins a ON a.id=p.owner_id`,
        )
        .get();
      assert.deepEqual(
        { ...row },
        {
          owner_id: 'original',
          project_id: 'legacy',
          code: 'original-printed-code',
          used_count: 1,
          photo_count: 1,
          message: 'Selamat!',
          storage_name: 'old.jpg',
          role: 'super',
          password_hash: 'existing-hash',
        },
      );
      assert.equal(
        (await db.prepare('SELECT partner_one FROM settings').get()).partner_one,
        'Rani',
      );
      assert.equal((await db.prepare('SELECT count(*) n FROM projects').get()).n, 1);
      db.close();
      db = undefined;
    }
  } finally {
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
