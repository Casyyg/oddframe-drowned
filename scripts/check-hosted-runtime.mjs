import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const mf=new Miniflare(convertV4MiniflareOptions({name:'oddframe',modules:true,scriptPath:'dist/server/index.js',compatibilityDate:'2026-09-10',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],bindings:{ADMIN_TOKEN:'runtime-test-key-0123456789abcdef000',PUBLIC_ORIGIN:'http://localhost'},assets:{directory:'dist/client',binding:'ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true}}}));
try {
  const db=await mf.getD1Database('DB');
  for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const statement of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))await db.prepare(statement.trim()).run();
  for(const [path,status] of [['/',200],['/drowned/',200],['/insights/',200],['/play/',404],['/api/drowned/stats',401],['/api/media/drowned/press-b13-v2.mp4',206]]) {
    const r=await mf.dispatchFetch('http://localhost'+path,{headers:path.endsWith('mp4')?{Range:'bytes=0-1023'}:{}});
    console.log(path,r.status,r.headers.get('content-type'));if(r.status!==status && r.headers.get('content-type')?.startsWith('text/'))console.log((await r.text()).slice(0,500));assert.equal(r.status,status);
    if(status===206)assert.equal((await r.arrayBuffer()).byteLength,1024);
  }
  const r=await mf.dispatchFetch('http://localhost/api/drowned/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({playerName:'Runtime test'})});
  const session=await r.json();assert.equal(r.status,201);assert.equal(session.playerName,'Runtime test');
  console.log('PASS: named session saved in isolated local D1 runtime');
} finally {await mf.dispose();}
