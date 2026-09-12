import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import worker, {serveMedia} from '../server/worker.mjs';
import {createD1Store} from '../server/d1-store.mjs';
import {validatePlayerName} from '../server/drowned.mjs';

function setup() {
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const DB={prepare(sql){let values=[];const query={bind(...args){values=args;return query;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};return query;}};
  const env={DB,ADMIN_TOKEN:'test-only-dashboard-secret-0123456789abcdef',PUBLIC_ORIGIN:'https://preview.example',ASSETS:{fetch:async()=>new Response('asset')}};
  const jobs=[];const ctx={waitUntil(p){jobs.push(p);}};
  const request=(path,body,token,extra={})=>worker.fetch(new Request('https://preview.example'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
  return {db,env,request,close:async()=>{await Promise.all(jobs);db.close();}};
}
test('Hosted media: normal, suffix and invalid byte ranges',async()=>{
  const full=()=>new Response(new Uint8Array(2048),{headers:{'Content-Type':'video/mp4','Content-Length':'2048'}});
  for(const [range,status,length] of [['bytes=0-1023',206,1024],['bytes=-128',206,128],['bytes=9999-',416,0],['bytes=-0',416,0],['bytes=4-2',416,0]]){
    const r=await serveMedia(new Request('https://preview.example/video.mp4',{headers:{Range:range}}),full());assert.equal(r.status,status);assert.equal((await r.arrayBuffer()).byteLength,length);
  }
});
test('Names: require bounded valid input while supporting English, Chinese and Mongolian',()=>{
  for(const name of ['Alex','小高','Золбоо'])assert.equal(validatePlayerName(' '+name+' '),name);
  for(const name of [null,{},'', ' ', 'x'.repeat(41),'<script>','a\nb','a\u202eb'])assert.throws(()=>validatePlayerName(name));
});
test('Public API: name persists; stats and exports are not anonymously exposed',async()=>{
  const s=setup();try{
    assert.equal((await s.request('/api/drowned/sessions',{})).status,400);
    assert.equal((await s.request('/api/drowned/sessions',{playerName:'Alex'},null,{origin:'https://evil.example'})).status,403);
    const response=await s.request('/api/drowned/sessions',{playerName:'Золбоо'});assert.equal(response.status,201);
    const session=await response.json();assert.equal(session.playerName,'Золбоо');
    const read=await s.request('/api/drowned/session',undefined,session.token);assert.equal((await read.json()).playerName,'Золбоо');assert.match(read.headers.get('cache-control'),/no-store/);
    assert.equal((await s.request('/api/drowned/stats')).status,401);
    assert.equal((await s.request('/api/drowned/stats',undefined,session.token)).status,401);
    const stats=await(await s.request('/api/drowned/stats',undefined,s.env.ADMIN_TOKEN)).json();assert.equal(stats.recent[0].playerName,'Золбоо');assert.ok(!JSON.stringify(stats).includes(session.token));
    s.env.ADMIN_TOKEN='';assert.equal((await s.request('/api/drowned/stats')).status,503);
  }finally{await s.close();}
});
test('Public API: retired story routes/media and endpoints are unavailable',async()=>{
  const s=setup();try{
    for(const path of ['/play/','/stats/','/api/stats','/api/session','/media/story.json','/api/media/drowned/unknown.mp4'])assert.equal((await s.request(path)).status,404,path);
    assert.equal(existsSync(new URL('../app/play/page.tsx',import.meta.url)),false);
    assert.equal(existsSync(new URL('../app/stats/page.tsx',import.meta.url)),false);
  }finally{await s.close();}
});
test('D1 adapter: all three endings, duplicate event IDs and expired records',async()=>{
  for(const ending of ['check-in','surface','erase']){
    const s=setup();try{
      let session=await(await s.request('/api/drowned/sessions',{playerName:'Release test'})).json();const token=session.token;
      async function action(type,extra={}){const body={requestId:randomUUID(),sceneId:session.sceneId,type,...extra};const r=await s.request('/api/drowned/events',body,token);assert.equal(r.status,200);session=await r.json();return body;}
      for(const choice of ['descend','look','answer','register']){await action('read');await action('choice',{choiceId:choice});}
      await action('read');if(ending==='erase')await action('line',{value:false});
      const body=await action('choice',{choiceId:ending});assert.equal((await s.request('/api/drowned/events',body,token)).status,200);
      await action('read');if(ending==='erase'){await action('choice',{choiceId:'return'});await action('read');}
      assert.ok(session.ending);const store=createD1Store(s.env.DB),raw=await store.get(token);
      assert.equal(raw.events.filter(e=>e.type==='ending').length,1);assert.equal(raw.playerName,'Release test');
      assert.equal(await store.put({...raw,version:raw.version+1,expiresAt:1},raw.version),true);
      assert.equal(await store.get(token),null);await store.purge();assert.equal(s.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
    }finally{await s.close();}
  }
});
