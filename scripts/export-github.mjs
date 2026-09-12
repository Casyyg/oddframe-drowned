import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,copyFileSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';

// Export current files, never local Git history, credentials, records or reports.
const root=resolve(import.meta.dirname,'..');
const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
const story=JSON.parse(readFileSync(join(root,'public/media/drowned/story.json'),'utf8'));
const media=new Set(['public/media/drowned/story.json',...story.scenes.flatMap(s=>['video','poster','captions'].filter(k=>s[k]).map(k=>'public/media/drowned/'+s[k]))]);
const files=tracked.filter(p=>!p.startsWith('.openai/')&&!p.startsWith('docs/')&&!p.startsWith('public/media/')&&p!=='scripts/build-report.py');
// The retired manifest is still an internal fixture imported by API tests; no old videos are exported.
files.push(...media,'public/media/story.json','tests/aws-routing.test.mjs','scripts/export-github.mjs');
for(const p of ['bootstrap.json','build-template.mjs','validate.py','edge-functions.mjs','smoke-test.py','template.json','deploy.py','release.py','runtime/package.json','runtime/package-lock.json'])files.push('aws/'+p);
const selected=[...new Set(files)].sort();
const artifactRoot=join(root,'artifacts');mkdirSync(artifactRoot,{recursive:true});
const target=mkdtempSync(join(artifactRoot,'github-source-'));
const manifest=[];
for(const p of selected){
  if(/(^|\/)(data|evidence|node_modules|\.git|\.openai)(\/|$)|account-review|deployment-secrets|\.env|\.(pem|sqlite|zip|pdf)$/i.test(p))throw new Error('Private or generated path: '+p);
  const source=join(root,p);if(lstatSync(source).isSymbolicLink())throw new Error('Symlink: '+p);
  const buffer=readFileSync(source);
  if(!/\.(mp4|jpeg|png)$/.test(p)&&/(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(buffer.toString()))throw new Error('Credential-like content in '+p);
  const dest=join(target,p);mkdirSync(dirname(dest),{recursive:true});copyFileSync(source,dest);
  manifest.push({path:p,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex')});
}
// Keep the logical preview binding, but never transfer ownership of the existing hosted Site.
const config=JSON.parse(readFileSync(join(root,'.openai/hosting.json'),'utf8'));
const safeConfig=JSON.stringify({d1:config.d1,r2:config.r2},null,2)+'\n';
mkdirSync(join(target,'.openai'),{recursive:true});writeFileSync(join(target,'.openai/hosting.json'),safeConfig);
manifest.push({path:'.openai/hosting.json',bytes:Buffer.byteLength(safeConfig),sha256:createHash('sha256').update(safeConfig).digest('hex')});
writeFileSync(join(artifactRoot,'github-source-manifest.json'),JSON.stringify({directory:target,files:manifest},null,2)+'\n');
console.log(JSON.stringify({directory:target,files:manifest.length,bytes:manifest.reduce((n,p)=>n+p.bytes,0),media:media.size-1}));
