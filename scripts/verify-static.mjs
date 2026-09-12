import { writeFileSync } from 'node:fs';
const origin='http://127.0.0.1:8787';const checks=[];
for(const path of ['/','/drowned/','/insights/','/play/','/stats/']){
 const response=await fetch(origin+path);const body=await response.text();checks.push({path,status:response.status,passed:response.ok&&body.includes('ODDFRAME')});
 const assets=[...body.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)].map(m=>m[1]);
 for(const asset of new Set(assets)){const r=await fetch(new URL(asset,origin),{method:'HEAD'});checks.push({asset,status:r.status,passed:r.ok});}
}
const health=await (await fetch(origin+'/api/health')).json();checks.push({path:'/api/health',passed:health.status==='ok'&&health.storage==='SQLite'});
const result={checkedAt:new Date().toISOString(),status:checks.every(c=>c.passed)?'PASS':'FAIL',scope:'HTTP checks of exported pages, referenced JS/CSS, and local SQLite health. Not browser UI testing.',checks};
writeFileSync('evidence/static-http-results.json',JSON.stringify(result,null,2)+'\n');console.log(result.status,checks.length,'HTTP checks');if(result.status!=='PASS')process.exitCode=1;
