import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
export const story=JSON.parse(readFileSync(new URL('../public/media/story.json',import.meta.url),'utf8'));
const scenes=new Map(story.scenes.map(s=>[s.sceneId,s]));
export class ApiError extends Error { constructor(status,message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new ApiError(status,message);};
const now=()=>new Date().toISOString();
function addEvent(session,type,detail={}){session.events.push({number:session.events.length+1,at:now(),sceneId:session.sceneId,type,...detail});}
export function publicSession(s){return {sceneId:s.sceneId,scene:scenes.get(s.sceneId),listen:s.listen,talk:s.talk,door:s.door,phone:s.phone,complete:s.complete,ending:s.ending,version:s.version,createdAt:s.createdAt,updatedAt:s.updatedAt};}
export async function startSession(store){
  const session={id:randomBytes(32).toString('hex'),version:0,sceneId:story.startSceneId,listen:true,talk:true,door:'locked',phone:'idle',complete:false,started:false,ending:null,createdAt:now(),updatedAt:now(),events:[],requests:[],expiresAt:Math.floor(Date.now()/1000)+30*86400};
  addEvent(session,'session_start');await store.put(session,null);return {token:session.id,...publicSession(session)};
}
export async function getSession(store,token){if(!/^[a-f0-9]{64}$/.test(token??''))fail(401,'Start a story to create a session.');const s=await store.get(token);if(!s||s.storyId||s.expiresAt< Date.now()/1000)fail(404,'This session has expired. Start a new story.');return s;}
export async function mutateSession(store,token,body){
  if(!body || typeof body!=='object'||!/^[-a-zA-Z0-9]{8,80}$/.test(body.requestId??''))fail(400,'A valid request ID is required.');
  for(let attempt=0;attempt<4;attempt++){
    const s=await getSession(store,token);
    if(s.requests.includes(body.requestId))return publicSession(s);
    if(s.events.length>=400)fail(429,'Session event limit reached. Start a new story.');
    if(body.sceneId!==s.sceneId)fail(409,'The story has moved on. Reload your saved session.');
    const scene=scenes.get(s.sceneId); const previous=s.version;
    if(body.type==='choice'){
      if(!s.complete||s.ending)fail(409,'Finish this scene before making a choice.');
      const choice=scene.choices.find(c=>c.choiceId===body.choiceId);if(!choice)fail(400,'That choice is not available here.');
      addEvent(s,'choice',{choiceId:choice.choiceId,label:choice.label,nextSceneId:choice.nextSceneId});
      if(choice.choiceId==='call'){s.phone='connected';addEvent(s,'phone_call',{contact:'Mum',state:s.phone});}
      if(choice.choiceId==='mic_off'){s.talk=false;addEvent(s,'switch',{control:'talk',value:false,listen:s.listen,talk:s.talk});}
      if(choice.choiceId==='listen_off'){s.listen=false;addEvent(s,'switch',{control:'listen',value:false,listen:s.listen,talk:s.talk});}
      if(choice.choiceId==='unlock'){s.door='open';addEvent(s,'door',{value:'open'});}
      if(choice.choiceId==='locked')addEvent(s,'door',{value:'locked'});
      s.sceneId=choice.nextSceneId;s.complete=false;s.started=false;
    }else if(['play','pause','seek','complete'].includes(body.type)){
      const position=body.position;
      if(typeof position!=='number'||!Number.isFinite(position)||position<0||position>scene.duration+1)fail(400,'Invalid playback position.');
      if(body.type==='complete'){
        if(!s.started||position<scene.duration-1)fail(409,'Play the scene to its end first.');
        if(!s.complete){s.complete=true;addEvent(s,'play_complete',{position});
          if(scene.ending){s.ending=scene.ending;addEvent(s,'ending',{ending:s.ending,listen:s.listen,talk:s.talk,door:s.door});}
        }
      }else{if(body.type==='play')s.started=true;addEvent(s,body.type,{position});}
    }else fail(400,'Unknown event type.');
    s.requests.push(body.requestId);s.version++;s.updatedAt=now();
    if(await store.put(s,previous))return publicSession(s);
  }
  fail(409,'Another action is being saved. Please retry.');
}
export async function statistics(store){
  const {items:raw,truncated}=await store.list(500);const items=raw.filter(s=>!s.storyId&&s.expiresAt>=Date.now()/1000);const events=items.flatMap(s=>s.events);
  const counts=(type,key)=>events.filter(e=>e.type===type).reduce((a,e)=>(a[e[key]]=(a[e[key]]??0)+1,a),{});
  return {generatedAt:now(),storage:store.name,sampled:truncated,scope:truncated?'Up to 500 sessions; not all-time totals':'All retained sessions (30-day retention)',sessions:items.length,completed:items.filter(s=>s.ending).length,plays:events.filter(e=>e.type==='play').length,choices:events.filter(e=>e.type==='choice').length,switchChanges:events.filter(e=>e.type==='switch').length,endings:counts('ending','ending'),choiceCounts:counts('choice','label'),events:events.length,recent:items.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20).map(s=>({session:s.id.slice(0,8),scene:scenes.get(s.sceneId).title,ending:s.ending,listen:s.listen,talk:s.talk,door:s.door,phone:s.phone,updatedAt:s.updatedAt,eventCount:s.events.length,timeline:s.events.slice(-12)}))};
}
