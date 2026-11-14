import { randomUUID } from 'node:crypto';

export async function migrateDatabase(db) {
  await db.transaction(async () => {
    async function addColumn(table, name, declaration) {
      const columns = await db.prepare(`PRAGMA table_info(${table})`).all();
      if (!columns.some((column) => column.name === name))
        await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`).run();
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
  });
}
