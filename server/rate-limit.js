// Shared between serverless instances; no per-instance login-limit bypass.
export class DatabaseRateLimitStore {
  localKeys = false;
  constructor(db, prefix) {
    this.db = db;
    this.prefix = prefix;
  }
  init(options) {
    this.windowMs = options.windowMs;
  }
  key(key) {
    return `${this.prefix}:${key}`;
  }
  async increment(key) {
    const now = Date.now();
    const row = await this.db
      .prepare(
        `
      INSERT INTO rate_limits(key,total_hits,reset_time) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET
        total_hits=CASE WHEN reset_time<=? THEN 1 ELSE total_hits+1 END,
        reset_time=CASE WHEN reset_time<=? THEN excluded.reset_time ELSE reset_time END
      RETURNING total_hits,reset_time
    `,
      )
      .get(this.key(key), now + this.windowMs, now, now);
    return { totalHits: row.total_hits, resetTime: new Date(row.reset_time) };
  }
  async decrement(key) {
    await this.db
      .prepare('UPDATE rate_limits SET total_hits=MAX(0,total_hits-1) WHERE key=?')
      .run(this.key(key));
  }
  async resetKey(key) {
    await this.db.prepare('DELETE FROM rate_limits WHERE key=?').run(this.key(key));
  }
}
