import { randomUUID } from 'node:crypto';

// SQLite cannot relax a CHECK constraint in place. Keep foreign keys enabled
// and copy the two referencing tables in dependency order within the migration.
async function allowUnlimitedQr(db) {
  const tables = ['qr_codes', 'guest_sessions', 'photos'];
  const schema = await db
    .prepare(
      "SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('qr_codes','guest_sessions','photos')",
    )
    .all();
  const definitions = Object.fromEntries(schema.map((row) => [row.name, row.sql]));
  if (!definitions.qr_codes.includes('total_limit BETWEEN 1 AND 1000000')) return;
  const indexes = await db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE tbl_name IN ('qr_codes','guest_sessions','photos') AND type IN ('index','trigger') AND sql IS NOT NULL",
    )
    .all();
  await db.prepare('DROP TRIGGER IF EXISTS first_wedding_project').run();
  for (const table of [...tables].reverse())
    await db.prepare(`ALTER TABLE ${table} RENAME TO ${table}_before_quota`).run();
  definitions.qr_codes = definitions.qr_codes
    .replace(
      'total_limit INTEGER NOT NULL CHECK(total_limit BETWEEN 1 AND 1000000)',
      'total_limit INTEGER CHECK(total_limit >= 1)',
    )
    .replace(
      'CHECK(per_session_limit BETWEEN 1 AND total_limit)',
      'CHECK(per_session_limit >= 1 AND (total_limit IS NULL OR per_session_limit <= total_limit))',
    );
  for (const table of tables) {
    await db.prepare(definitions[table]).run();
    await db.prepare(`INSERT INTO ${table} SELECT * FROM ${table}_before_quota`).run();
  }
  for (const table of [...tables].reverse())
    await db.prepare(`DROP TABLE ${table}_before_quota`).run();
  for (const { sql } of indexes) await db.prepare(sql).run();
}

export async function migrateDatabase(db) {
  await db.transaction(async () => {
    async function addColumn(table, name, declaration) {
      const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
      if (columns.some((column) => column.name === name)) return false;
      await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`).run();
      return true;
    }
    await addColumn('photos', 'message', "TEXT NOT NULL DEFAULT '' CHECK(length(message) <= 500)");
    await addColumn('admins', 'username', 'TEXT COLLATE NOCASE');
    await addColumn(
      'admins',
      'role',
      "TEXT NOT NULL DEFAULT 'super' CHECK(role IN ('super','project'))",
    );
    await addColumn('admins', 'active', 'INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))');
    await db
      .prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_username ON admins(username)')
      .run();
    for (const admin of await db
      .prepare('SELECT id FROM admins WHERE username IS NULL ORDER BY created_at,id')
      .all()) {
      await db
        .prepare('UPDATE admins SET username=? WHERE id=?')
        .run('studio-' + randomUUID(), admin.id);
    }
    await addColumn('qr_codes', 'project_id', 'TEXT REFERENCES projects(id) ON DELETE RESTRICT');
    await allowUnlimitedQr(db);
    await addColumn('qr_codes', 'created_by', 'TEXT REFERENCES admins(id) ON DELETE RESTRICT');
    await addColumn('qr_codes', 'deleted_at', 'TEXT');
    await addColumn('settings', 'default_total', 'INTEGER NOT NULL DEFAULT 1');
    await addColumn('settings', 'default_per', 'INTEGER NOT NULL DEFAULT 1');
    await db
      .prepare(
        `INSERT OR IGNORE INTO projects(id,owner_id,name)
      SELECT 'legacy',id,'Pernikahan utama' FROM admins WHERE role='super' ORDER BY created_at,id LIMIT 1`,
      )
      .run();
    // Installations may be initialized before the first administrator is provisioned.
    await db
      .prepare(
        `CREATE TRIGGER IF NOT EXISTS first_wedding_project AFTER INSERT ON admins
      WHEN NEW.role='super' AND NOT EXISTS (SELECT 1 FROM projects WHERE id='legacy')
      BEGIN
        INSERT INTO projects(id,owner_id,name) VALUES('legacy',NEW.id,'Pernikahan utama');
        UPDATE qr_codes SET project_id='legacy' WHERE project_id IS NULL;
      END`,
      )
      .run();
    await db
      .prepare(
        "UPDATE qr_codes SET project_id='legacy' WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM projects WHERE id='legacy')",
      )
      .run();
    await db
      .prepare(
        "CREATE TRIGGER IF NOT EXISTS qr_requires_project BEFORE INSERT ON qr_codes WHEN NEW.project_id IS NULL BEGIN SELECT RAISE(ABORT,'Project required'); END",
      )
      .run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_project ON qr_codes(project_id)').run();
    await db
      .prepare(
        'UPDATE qr_codes SET created_by=(SELECT owner_id FROM projects WHERE id=qr_codes.project_id) WHERE created_by IS NULL',
      )
      .run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_qr_creator ON qr_codes(created_by)').run();
    if (
      await addColumn('admins', 'photo_quota', 'INTEGER NOT NULL DEFAULT 0 CHECK(photo_quota>=0)')
    ) {
      await db
        .prepare(
          "UPDATE admins SET photo_quota=(SELECT COALESCE(SUM(total_limit),0) FROM qr_codes WHERE created_by=admins.id) WHERE role='project'",
        )
        .run();
    }
    await db
      .prepare(
        `CREATE VIEW IF NOT EXISTS account_quota AS
      SELECT a.id, a.role, a.photo_quota, COALESCE(SUM(CASE WHEN q.deleted_at IS NULL THEN q.total_limit ELSE q.used_count END),0) AS allocated
      FROM admins a LEFT JOIN qr_codes q ON q.created_by=a.id GROUP BY a.id`,
      )
      .run();
    const images = await db
      .prepare("SELECT sql FROM sqlite_master WHERE name='project_images'")
      .get();
    if (images && !images.sql.includes("'couple'")) {
      await db
        .prepare('ALTER TABLE project_images RENAME TO project_images_before_portraits')
        .run();
      await db
        .prepare(
          `CREATE TABLE project_images (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        slot TEXT NOT NULL CHECK(slot IN ('hero','background','banner','decoration','logo','couple')),
        jpeg BLOB NOT NULL, PRIMARY KEY(project_id,slot))`,
        )
        .run();
      await db
        .prepare(
          'INSERT INTO project_images SELECT project_id,slot,jpeg FROM project_images_before_portraits',
        )
        .run();
      await db.prepare('DROP TABLE project_images_before_portraits').run();
    }
  });
}
