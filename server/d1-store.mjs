// Hosted storage implements the existing optimistic-concurrency store contract.
export function createD1Store(db) {
  const currentTime = () => Math.floor(Date.now()/1000);
  return {
    name: 'Cloudflare D1',
    async get(id) {
      const row = await db.prepare('SELECT payload FROM sessions WHERE id=? AND expires_at>=?').bind(id,currentTime()).first();
      return row ? JSON.parse(row.payload) : null;
    },
    async put(item, expected) {
      const query = expected === null
        ? db.prepare('INSERT OR IGNORE INTO sessions(id,version,updated_at,expires_at,payload) VALUES(?,?,?,?,?)').bind(item.id,item.version,item.updatedAt,item.expiresAt,JSON.stringify(item))
        : db.prepare('UPDATE sessions SET version=?,updated_at=?,expires_at=?,payload=? WHERE id=? AND version=?').bind(item.version,item.updatedAt,item.expiresAt,JSON.stringify(item),item.id,expected);
      const result = await query.run();
      return result.meta.changes === 1;
    },
    async list(limit=500) {
      const result = await db.prepare('SELECT payload FROM sessions WHERE expires_at>=? ORDER BY updated_at DESC LIMIT ?').bind(currentTime(),limit+1).all();
      return {items:result.results.slice(0,limit).map(row=>JSON.parse(row.payload)),truncated:result.results.length>limit};
    },
    async purge() { await db.prepare('DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at<? LIMIT 100)').bind(currentTime()).run(); },
    close() {},
  };
}
