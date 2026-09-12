import { existsSync } from 'node:fs';
import { spawn,spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeServer } from '../server/index.mjs';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
if(!existsSync('dist/client/drowned.html')||!existsSync('dist/client/insights.html')){const result=spawnSync('npm',['run','build'],{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);}
const port=Number(process.env.PORT??8787);const server=await makeServer();
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`Port ${port} is already in use. Open http://127.0.0.1:${port} if OddFrame is already running.`:e.message);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{console.log(`OddFrame is ready: http://127.0.0.1:${port}\nKeep this window open. Press Ctrl+C to stop.`);if(process.env.OPEN_BROWSER==='1'&&process.platform==='darwin')spawn('open',[`http://127.0.0.1:${port}`],{stdio:'ignore'});});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
