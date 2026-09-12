import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { startSession,getSession,mutateSession,statistics,story } from '../server/game.mjs';
const fresh=()=>createStore({path:':memory:'});
const mutate=(store,s,type,extra={})=>mutateSession(store,s.token,{requestId:randomUUID(),sceneId:s.sceneId,type,...extra});
async function finish(store,s){await mutate(store,s,'play',{position:0});return {...await mutate(store,s,'complete',{position:s.scene.duration}),token:s.token};}
async function choice(store,s,id){return {...await mutate(store,s,'choice',{choiceId:id}),token:s.token};}
async function route(store,ids){let s=await startSession(store);for(const id of ids){s=await finish(store,s);s=await choice(store,s,id);}return finish(store,s);}
for(const [name,path,expected] of [
 ['A: outgoing microphone off; door kept locked',['call','listen','mic_off','wait','locked'],['ENDING A',false,true,'locked']],
 ['B: unlock directly after the clue',['call','listen','unlock'],['ENDING B',true,true,'open']],
 ['C: hearing off while outgoing microphone stays on',['call','listen','listen_off'],['ENDING C',true,false,'locked']],
 ['A: optional personal question',['call','listen','question','mic_off','wait','locked'],['ENDING A',false,true,'locked']],
 ['B: unlock after muting; preserve OFF state',['call','listen','mic_off','wait','unlock'],['ENDING B',false,true,'open']],
 ['C: wrong switch after personal question',['call','listen','question','listen_off'],['ENDING C',true,false,'locked']]
])test(name,async()=>{const store=await fresh();try{const s=await route(store,path);assert.deepEqual([s.ending,s.talk,s.listen,s.door],expected);const raw=await getSession(store,s.token);assert.equal(raw.events.filter(e=>e.type==='ending').length,1);assert.equal(raw.phone,'connected');}finally{store.close();}});
test('Choice is locked until playback completes',async()=>{const store=await fresh();try{const s=await startSession(store);await assert.rejects(mutate(store,s,'choice',{choiceId:'call'}),e=>e.status===409);await assert.rejects(mutate(store,s,'complete',{position:0}),e=>e.status===409);}finally{store.close();}});
test('Invalid choice, stale scene, and malformed position are rejected',async()=>{const store=await fresh();try{let s=await startSession(store);await assert.rejects(mutate(store,s,'seek',{position:-1}),e=>e.status===400);s=await finish(store,s);await assert.rejects(mutate(store,s,'choice',{choiceId:'injected-ending'}),e=>e.status===400);const old={...s};s=await choice(store,s,'call');await assert.rejects(mutate(store,old,'play',{position:0}),e=>e.status===409);}finally{store.close();}});
test('Retry IDs and concurrent identical choices never duplicate a transition',async()=>{const store=await fresh();try{let s=await startSession(store);s=await finish(store,s);const body={requestId:randomUUID(),sceneId:s.sceneId,type:'choice',choiceId:'call'};await Promise.all([mutateSession(store,s.token,body),mutateSession(store,s.token,body)]);await mutateSession(store,s.token,body);const raw=await getSession(store,s.token);assert.equal(raw.events.filter(e=>e.type==='choice').length,1);assert.equal(raw.events.filter(e=>e.type==='phone_call').length,1);}finally{store.close();}});
test('SQLite survives database close and reopen; bearer token required',async()=>{const path=join(mkdtempSync(join(tmpdir(),'oddframe-test-')),'sessions.sqlite');let store=await createStore({path});let s=await startSession(store);s=await finish(store,s);s=await choice(store,s,'call');store.close();store=await createStore({path});try{const persisted=await getSession(store,s.token);assert.equal(persisted.sceneId,'02_two_mothers');assert.equal(persisted.phone,'connected');await assert.rejects(getSession(store,'not-a-session'),e=>e.status===401);}finally{store.close();}});
test('Statistics count all three endings, switches and decisions, without bearer tokens',async()=>{const store=await fresh();try{const a=await route(store,['call','listen','mic_off','wait','locked']);await route(store,['call','listen','unlock']);await route(store,['call','listen','listen_off']);const stats=await statistics(store);assert.deepEqual(stats.endings,{'ENDING A':1,'ENDING B':1,'ENDING C':1});assert.equal(stats.sessions,3);assert.equal(stats.completed,3);assert.equal(stats.switchChanges,2);assert.equal(stats.choices,11);assert.equal(stats.plays,14);assert.ok(!JSON.stringify(stats).includes(a.token));}finally{store.close();}});
test('Expired sessions cannot resume and are excluded from statistics',async()=>{const store=await fresh();try{const s=await startSession(store);const raw=await getSession(store,s.token);raw.expiresAt=1;await store.put({...raw,version:1},0);await assert.rejects(getSession(store,s.token),e=>e.status===404);assert.equal((await statistics(store)).sessions,0);}finally{store.close();}});
test('HTTP API validates origins, body types, admin access and MP4 range requests',async()=>{
 const store=await fresh();const adminToken='test-only-admin-token-0123456789abcdef';const server=await makeServer({store,production:true,adminToken});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
   assert.equal((await fetch(url+'/api/health')).status,200);
   assert.equal((await fetch(url+'/api/stats')).status,401);
   assert.equal((await fetch(url+'/api/stats',{headers:{Authorization:'Bearer '+adminToken}})).status,200);
   assert.equal((await fetch(url+'/api/sessions',{method:'POST',body:'{}'})).status,415);
   assert.equal((await fetch(url+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://not-oddframe.example'},body:'{}'})).status,403);
   const r=await fetch(url+'/api/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,201);const s=await r.json();
   assert.equal((await fetch(url+'/api/session',{headers:{Authorization:'Bearer '+s.token}})).status,200);
   const media='/media/'+story.scenes[0].video;
   const range=await fetch(url+media,{headers:{Range:'bytes=0-1023'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);assert.match(range.headers.get('content-range'),/^bytes 0-1023\//);
   const suffix=await fetch(url+media,{headers:{Range:'bytes=-128'}});assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,128);
   assert.equal((await fetch(url+media,{headers:{Range:'bytes=999999999-'}})).status,416);
   assert.equal((await fetch(url+'/api/session')).headers.get('permissions-policy'),'camera=(), microphone=(), geolocation=()');
 }finally{await new Promise(r=>server.close(r));}
});
