import { spawnSync } from 'node:child_process';
import { mkdirSync,writeFileSync,existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
mkdirSync('evidence',{recursive:true});
const checks=[];
for(const [name,cmd,args] of [ ['integration','npm',['test']],['drowned-source-lint','npx',['oxlint','app/page.tsx','app/drowned/page.tsx','app/insights/page.tsx','lib/drowned-client.ts','server/drowned.mjs','tests/drowned.test.mjs','components/language-provider.tsx','lib/localization.tsx','lib/use-sound-autoplay.ts','lib/sound-playback.ts']],['typecheck','npx',['tsc','--noEmit']],['build','npm',['run','build:hosted']],['dependency-audit','npm',['audit','--json']] ]){
  const start=Date.now();const result=spawnSync(cmd,args,{encoding:'utf8',maxBuffer:20*1024*1024});writeFileSync(`evidence/${name}.log`,result.stdout+result.stderr);checks.push({name,passed:result.status===0,exitCode:result.status,elapsedMs:Date.now()-start});console.log(name,result.status===0?'PASS':'FAIL');
}
const routes=['index.html','drowned.html','insights.html'];checks.push({name:'all-static-routes',passed:routes.every(p=>existsSync('dist/client/'+p))});
checks.push({name:'retired-pages-excluded',passed:!existsSync('dist/client/play.html')&&!existsSync('dist/client/stats.html')});
const media=[];
const drowned=JSON.parse(readFileSync('public/media/drowned/story.json'));
const drownedMedia=drowned.scenes.filter(s=>s.video).map(s=>{const path='public/media/drowned/'+s.video;return {file:s.video,exists:existsSync(path),sha256:existsSync(path)?createHash('sha256').update(readFileSync(path)).digest('hex'):null};});
media.push(...drownedMedia);checks.push({name:'drowned-available-media',passed:drownedMedia.every(m=>m.exists)});
checks.push({name:'drowned-missing-shots-explicitly-null',passed:drowned.scenes.filter(s=>!s.video).every(s=>s.video===null&&s.duration===null&&s.poster===null&&!!s.productionNote)});
const summary={recordedAt:new Date().toISOString(),environment:{node:process.version,platform:process.platform,arch:process.arch},status:checks.every(c=>c.passed)?'PASS':'FAIL',checks,media,notes:['Integration tests simulate player events; they do not prove human viewing or browser playback.','Tests use isolated databases, not the live demo database.','This local check does not verify AWS deployment or account Free Tier eligibility; see separate cloud evidence.','WebMCP tools are optional and not verified in a supporting browser context.']};
writeFileSync('evidence/test-results.json',JSON.stringify(summary,null,2)+'\n');if(summary.status==='FAIL')process.exitCode=1;
