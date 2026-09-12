import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const manifest = JSON.parse(readFileSync('public/media/drowned/story.json','utf8'));
const executable = process.env.FFMPEG ?? 'ffmpeg';
const checks = [];
for (const scene of manifest.scenes.filter(s => s.video)) {
  const file = resolve('public/media/drowned', scene.video);
  const result = spawnSync(executable,['-hide_banner','-nostdin','-i',file,'-f','null','-'],{encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(result.stderr ?? '');
  const duration = match ? Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) : null;
  const passed = result.status === 0 && duration !== null && Math.abs(duration-scene.duration)<0.2;
  checks.push({scene:scene.id,file:scene.video,passed,declaredDuration:scene.duration,decodedDuration:duration,exitCode:result.status,error:result.error?.message});
  console.log(scene.id, passed ? 'PASS' : 'FAIL', duration);
}
const result = {recordedAt:new Date().toISOString(),status:checks.every(c=>c.passed)?'PASS':'FAIL',scope:`Full FFmpeg decode and duration checks of the ${checks.length} available media files. Not browser playback, audio-quality or visual-continuity testing.`,checks};
mkdirSync('evidence',{recursive:true}); writeFileSync('evidence/drowned-media-checks.json',JSON.stringify(result,null,2)+'\n');
if(result.status!=='PASS')process.exitCode=1;
