import { timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { startDrowned,getDrowned,publicDrowned,mutateDrowned,drownedStats,validatePlayerName,drownedStory } from './drowned.mjs';
import { createD1Store } from './d1-store.mjs';
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(), microphone=(), geolocation=()'};
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers});
const limits = new Map();
const videoFiles = new Set(drownedStory.scenes.map(scene=>scene.video).filter(Boolean));
export async function serveMedia(request,response) {
  if(response.status!==200 || !response.headers.get('content-type')?.startsWith('video/mp4'))return response;
  const h=new Headers(response.headers);h.set('Accept-Ranges','bytes');
  const range=request.headers.get('range'),condition=request.headers.get('if-range');
  if(!range || (condition && condition!==h.get('etag') && condition!==h.get('last-modified')))return new Response(response.body,{status:200,headers:h});
  // The curated release enforces an 8 MiB ceiling per clip. No unbounded files are buffered.
  const bytes=await response.arrayBuffer(),size=bytes.byteLength,m=/^bytes=(\d*)-(\d*)$/.exec(range);
  const start=m?.[1]?Number(m[1]):Math.max(0,size-Number(m?.[2]));
  const end=m?.[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(!m||(!m[1]&&!m[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=size){h.set('Content-Range',`bytes */${size}`);h.delete('Content-Length');return new Response(null,{status:416,headers:h});}
  h.set('Content-Range',`bytes ${start}-${end}/${size}`);h.set('Content-Length',String(end-start+1));
  return new Response(bytes.slice(start,end+1),{status:206,headers:h});
}
async function readBody(request) {
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new ApiError(415,'Use application/json.');
  const reader=request.body?.getReader();if(!reader)throw new ApiError(400,'Invalid JSON.');
  let size=0,text='';const decoder=new TextDecoder();
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new ApiError(413,'Request is too large.');}text+=decoder.decode(value,{stream:true});}
  try{return JSON.parse(text+decoder.decode());}catch{throw new ApiError(400,'Invalid JSON.');}
}
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url),path=url.pathname;
    // Use a dynamic URL so the platform's static fast path cannot strip byte ranges.
    if(path.startsWith('/api/media/drowned/')) {
      if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed.'},405);
      if(!videoFiles.has(path.slice('/api/media/drowned/'.length)))return json({error:'Not found.'},404);
      const assetUrl=new URL(request.url);assetUrl.pathname=path.slice(4);
      const assetHeaders=new Headers(request.headers);assetHeaders.delete('range');assetHeaders.delete('if-range');
      const response=await env.ASSETS.fetch(new Request(assetUrl,{method:request.method,headers:assetHeaders}));
      return request.method==='GET'?serveMedia(request,response):response;
    }
    if(!path.startsWith('/api/')) {
      if(/^\/(play|stats)(\/|$)/.test(path) || (path.startsWith('/media/')&&!path.startsWith('/media/drowned/')))return json({error:'Not found.'},404);
      const response=await env.ASSETS.fetch(request);
      return request.method==='GET'?serveMedia(request,response):response;
    }
    try {
      const origin=request.headers.get('origin');
      if(origin && origin!==(env.PUBLIC_ORIGIN||url.origin))throw new ApiError(403,'This origin is not allowed.');
      if(request.headers.get('sec-fetch-site')==='cross-site')throw new ApiError(403,'This origin is not allowed.');
      const now=Date.now(),ip=request.headers.get('cf-connecting-ip')||'local';
      for(const [key,value] of limits)if(value.until<now)limits.delete(key);
      if(limits.size>=2000&&!limits.has(ip))throw new ApiError(429,'Too many requests. Try again shortly.');
      const rate=limits.get(ip)||{until:now+60000,count:0};limits.set(ip,rate);
      if(++rate.count>180)throw new ApiError(429,'Too many requests. Try again shortly.');
      const store=createD1Store(env.DB);
      if(path==='/api/health'&&request.method==='GET')return json({ok:true,storage:store.name});
      const token=(request.headers.get('authorization')||'').replace(/^Bearer /,'');
      if(path==='/api/drowned/stats'&&request.method==='GET') {
        const expected=env.ADMIN_TOKEN;
        if(!expected || expected.length<32)throw new ApiError(503,'Dashboard access is not configured.');
        const a=new TextEncoder().encode(token),b=new TextEncoder().encode(expected);
        if(a.length!==b.length||!timingSafeEqual(a,b))throw new ApiError(401,'Enter the dashboard access key.');
        return json(await drownedStats(store));
      }
      if(path==='/api/drowned/sessions'&&request.method==='POST') {
        const body=await readBody(request);
        const result=await startDrowned(store,validatePlayerName(body?.playerName));
        ctx.waitUntil(store.purge().catch(()=>{}));return json(result,201);
      }
      if(path==='/api/drowned/session'&&request.method==='GET')return json(publicDrowned(await getDrowned(store,token)));
      if(path==='/api/drowned/events'&&request.method==='POST')return json(await mutateDrowned(store,token,await readBody(request)));
      throw new ApiError(404,'Not found.');
    } catch(error) {return json({error:error.status?error.message:'The story could not be saved. Please retry.'},error.status||500);}
  },
};
