import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export async function createStore(options = {}) {
  if ((options.driver ?? process.env.DB_DRIVER) === 'dynamodb') {
    const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
    const TableName = process.env.DYNAMODB_TABLE;
    if (!TableName) throw new Error('DYNAMODB_TABLE is required');
    return {
      name: 'DynamoDB',
      async get(id) { return (await client.send(new GetCommand({ TableName, Key:{id}, ConsistentRead:true }))).Item ?? null; },
      async put(item, expected) {
        try {
          await client.send(new PutCommand({ TableName, Item:item,
            ConditionExpression:expected === null ? 'attribute_not_exists(id)' : '#v = :v',
            ...(expected === null ? {} : {ExpressionAttributeNames:{'#v':'version'},ExpressionAttributeValues:{':v':expected}}) }));
          return true;
        } catch(e) { if(e.name === 'ConditionalCheckFailedException') return false; throw e; }
      },
      async list(limit=500) {
        const items=[]; let cursor;
        do { const result=await client.send(new ScanCommand({TableName,Limit:Math.min(50,limit-items.length),ExclusiveStartKey:cursor})); items.push(...(result.Items??[])); cursor=result.LastEvaluatedKey; } while(cursor && items.length<limit);
        return {items,truncated:!!cursor};
      },
      close(){client.destroy();}
    };
  }
  const { DatabaseSync } = await import('node:sqlite');
  const path=options.path ?? process.env.DB_PATH ?? 'data/oddframe.sqlite';
  if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, version INTEGER NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC)');
  db.exec('PRAGMA optimize');
  const purge=()=>db.prepare("DELETE FROM sessions WHERE CAST(json_extract(payload, '$.expiresAt') AS INTEGER) < ?").run(Math.floor(Date.now()/1000));
  purge();const cleanup=setInterval(purge,60*60*1000);cleanup.unref();
  return {
    name:'SQLite',
    async get(id){const row=db.prepare('SELECT payload FROM sessions WHERE id = ?').get(id);return row ? JSON.parse(row.payload) : null;},
    async put(item,expected){
      if(expected===null)return db.prepare('INSERT OR IGNORE INTO sessions(id,version,updated_at,payload) VALUES(?,?,?,?)').run(item.id,item.version,item.updatedAt,JSON.stringify(item)).changes===1;
      return db.prepare('UPDATE sessions SET version=?, updated_at=?, payload=? WHERE id=? AND version=?').run(item.version,item.updatedAt,JSON.stringify(item),item.id,expected).changes===1;
    },
    async list(limit=500){const rows=db.prepare('SELECT payload FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit+1);return {items:rows.slice(0,limit).map(r=>JSON.parse(r.payload)),truncated:rows.length>limit};},
    close(){clearInterval(cleanup);db.close();}
  };
}
