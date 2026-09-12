import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const ffmpeg='/Users/casgao/Desktop/SPI/615/Ass4/work/oddframe/deps/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';
const root='public/media/drowned/';
const story=JSON.parse(readFileSync(root+'story.json','utf8'));
const results=[];
for(const s of story.scenes){
 const r=spawnSync(ffmpeg,['-hide_banner','-i',root+s.video,'-f','null','-'],{encoding:'utf8'});
 const m=/Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);
 const duration=m ? +m[1]*3600 + +m[2]*60 + +m[3] : null;
 const p=spawnSync(ffmpeg,['-v','error','-i',root+s.poster,'-f','null','-'],{encoding:'utf8'});
 const captionExists=!s.captions || existsSync(root+s.captions);
 results.push({scene:s.id,file:s.video,sha256:createHash('sha256').update(readFileSync(root+s.video)).digest('hex'),duration,
  fullDecode:r.status===0,audio:r.stderr.includes('Audio:'),poster:s.poster,posterDecodes:p.status===0,
  caption:s.captions || null,captionExists,durationMatches:duration!==null&&Math.abs(duration-s.duration)<0.1});
}
const report={at:new Date().toISOString(),scenes:results.length,totalFootageSeconds:results.reduce((n,r)=>n+r.duration,0),
 passed:results.every(r=>r.fullDecode&&r.audio&&r.posterDecodes&&r.captionExists&&r.durationMatches),results,
 limits:['Full decode detects file errors, not visual correctness.','Audio streams and ASR do not certify listening quality or lip sync.']};
writeFileSync('evidence/revision-2026-09-10/media-verification.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!report.passed)process.exitCode=1;
