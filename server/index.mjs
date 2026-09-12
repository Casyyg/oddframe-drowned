import { createServer } from 'node:http';
import { createReadStream,existsSync,statSync } from 'node:fs';
import { resolve,extname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { createStore } from './store.mjs';
import { ApiError } from './errors.mjs';
import { startDrowned, getDrowned, publicDrowned, mutateDrowned, drownedStats, validatePlayerName } from './drowned.mjs';
const base=resolve(fileURLToPath(new URL('..',import.meta.url)));
function equal(a,b){const x=Buffer.from(a??''),y=Buffer.from(b??'');return x.length===y.length&&timingSafeEqual(x,y);}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function json(req){let value='';for await(const part of req){value+=part;if(value.length>8192)throw new ApiError(413,'Request is too large.');}try{return JSON.parse(value||'{}');}catch{throw new ApiError(400,'Invalid JSON.');}}
export async function makeServer(options={}){
  const store=options.store??await createStore(options);
  const production=options.production??process.env.NODE_ENV==='production';
  const admin=options.adminToken??process.env.ADMIN_TOKEN;
  const originSecret=process.env.ORIGIN_SECRET;
  if(production&&(!admin||admin.length<32))throw new Error('Production requires an ADMIN_TOKEN of at least 32 characters.');
  const limits=new Map();
  const server=createServer(async(req,res)=>{
    const start=Date.now();let pathname='/';
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    try{
      pathname=new URL(req.url,'http://local').pathname;
      if(pathname.startsWith('/api/media/drowned/'))return serveStatic(req,res,pathname.slice(4));
      if(!pathname.startsWith('/api/'))return serveStatic(req,res,pathname);
      if(originSecret&&!equal(req.headers['x-origin-secret'],originSecret))throw new ApiError(403,'Use the application URL.');
      const suppliedOrigin=req.headers.origin;
      const allowedOrigin=process.env.PUBLIC_ORIGIN;
      if(suppliedOrigin && suppliedOrigin!==(allowedOrigin??`${production?'https':'http'}://${req.headers.host}`) && !(!production&&suppliedOrigin==='http://127.0.0.1:5173'))throw new ApiError(403,'This origin is not allowed.');
      // Local per-process abuse guard; not a distributed production rate limiter.
      const key=req.socket.remoteAddress;const stamp=Date.now();let entry=limits.get(key);
      if(!entry||entry.until<stamp){entry={until:stamp+60000,count:0};limits.set(key,entry);}if(++entry.count>600)throw new ApiError(429,'Too many requests. Try again shortly.');
      if(limits.size>10000){for(const [k,v] of limits)if(v.until<stamp)limits.delete(k);}
      if(req.method==='GET'&&pathname==='/api/health'){await store.get('_health_probe_');return send(res,200,{status:'ok',storage:store.name,mode:production?'production':'local'});}
      if(req.method==='POST'&&!String(req.headers['content-type']).startsWith('application/json'))throw new ApiError(415,'Use application/json.');
      const token=String(req.headers.authorization??'').replace(/^Bearer /,'');
      if(pathname==='/api/drowned/sessions'&&req.method==='POST'){const body=await json(req);return send(res,201,await startDrowned(store,validatePlayerName(body?.playerName)));}
      if(pathname==='/api/drowned/session'&&req.method==='GET')return send(res,200,publicDrowned(await getDrowned(store,token)));
      if(pathname==='/api/drowned/events'&&req.method==='POST')return send(res,200,await mutateDrowned(store,token,await json(req)));
      if(pathname==='/api/drowned/stats'&&req.method==='GET'){
        if(admin&&!equal(token,admin))throw new ApiError(401,'Enter the dashboard access key.');
        return send(res,200,await drownedStats(store));
      }
      throw new ApiError(404,'Not found.');
    }catch(e){if(!res.headersSent)send(res,e.status??500,{error:e.status?e.message:'The story could not be saved. Please retry.'});else res.end();if(!e.status)console.error(JSON.stringify({level:'error',message:e.name}));}
    finally{if(pathname.startsWith('/api/'))console.log(JSON.stringify({at:new Date().toISOString(),method:req.method,path:pathname,status:res.statusCode,ms:Date.now()-start}));}
  });
  server.on('close',()=>store.close());return server;
}
function serveStatic(req,res,pathname){
  if(/^\/(play|stats)(\/|$)/.test(pathname) || (pathname.startsWith('/media/') && !pathname.startsWith('/media/drowned/')))return send(res,404,{error:'Not found.'});
  if(!['GET','HEAD'].includes(req.method))return send(res,405,{error:'Method not allowed.'});
  const root=pathname.startsWith('/media/')?resolve(base,'public'):resolve(base,process.env.STATIC_DIR??'dist/client');
  let file;try{file=resolve(root,'.'+decodeURIComponent(pathname));}catch{return send(res,400,{error:'Invalid path.'});}
  if(!file.startsWith(root+sep)&&file!==root)return send(res,403,{error:'Forbidden.'});
  if(existsSync(file)&&statSync(file).isDirectory())file=resolve(file,'index.html');
  if(!existsSync(file)&&!extname(file)){const flat=file.replace(/\/$/,'')+'.html';if(existsSync(flat))file=flat;}
  if(!existsSync(file)||!statSync(file).isFile())return send(res,404,{error:'Not found.'});
  const size=statSync(file).size;const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.vtt':'text/vtt','.woff2':'font/woff2','.rsc':'text/x-component'}[extname(file)]??'application/octet-stream';
  res.setHeader('Content-Type',mime);res.setHeader('Accept-Ranges','bytes');res.setHeader('Cache-Control',extname(file)==='.html'?'no-cache':'public, max-age=3600');
  let start=0,end=size-1,status=200;
  if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}status=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);}
  res.writeHead(status,{'Content-Length':end-start+1});if(req.method==='HEAD')return res.end();createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT??8787),host=process.env.HOST??'127.0.0.1';const server=await makeServer();server.listen(port,host,()=>console.log(`OddFrame API: http://${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
