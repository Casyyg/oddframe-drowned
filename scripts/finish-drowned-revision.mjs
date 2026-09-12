import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const ffmpeg='/Users/casgao/Desktop/SPI/615/Ass4/work/oddframe/deps/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';
const media=resolve('public/media/drowned');
const evidence=resolve('evidence/revision-2026-09-10');
const path=resolve(media,'story.json');
const story=JSON.parse(readFileSync(path,'utf8'));
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status)throw new Error(r.stderr);}
function output(name){const p=resolve(media,name);if(existsSync(p))throw new Error('Preserve existing revision: '+name);return p;}

// Remove the unintended fire and final reopening. A blink hides the identity cut.
const checkin=output('check-in-transformation-v3.mp4');
run(['-i',resolve(evidence,'check-in-flow-original.mp4'),'-i',resolve(evidence,'check-in-voice.aiff'),'-f','lavfi','-i','anoisesrc=color=brown:amplitude=0.06:sample_rate=48000:duration=8',
 '-filter_complex',[
  '[0:v]trim=start=0:end=0.875,setpts=PTS-STARTPTS,fade=t=out:st=0.625:d=0.25[v0]',
  'color=c=black:s=720x1280:r=24:d=0.375[blink]',
  '[0:v]trim=start=2.75:end=5,setpts=3*(PTS-STARTPTS),fps=24,fade=t=in:st=0:d=0.167[v1]',
  '[v0][blink][v1]concat=n=3:v=1:a=0,tpad=stop_mode=clone:stop_duration=0.2,trim=duration=8[v]',
  '[1:a]highpass=f=100,loudnorm=I=-19:TP=-2:LRA=7,adelay=3000|3000,apad[voice]',
  '[2:a]highpass=f=45,lowpass=f=320,afade=t=in:d=0.15,afade=t=out:st=7.6:d=0.4[room]',
  '[voice][room]amix=inputs=2:normalize=0,alimiter=limit=0.89[a]',
 ].join(';'),'-map','[v]','-map','[a]','-t','8','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',checkin]);
run(['-i',checkin,'-frames:v','1','-q:v','2',output('check-in-transformation-v3.jpeg')]);
const scene=story.scenes.find(s=>s.id==='check-in');
Object.assign(scene,{video:'check-in-transformation-v3.mp4',poster:'check-in-transformation-v3.jpeg',duration:8,captions:'check-in-en-v3.vtt',productionNote:'Flow picture recut to remove unintended fire and reopening; synthetic English dialogue. Automated speech check supplements, but does not replace, final listening review.'});
writeFileSync(resolve(media,scene.captions),'WEBVTT\n\n00:00:03.000 --> 00:00:06.600\nWe have been expecting the surface guest.\n');

// Add a brief, restrained telephone ring where the story introduces it.
for(const id of ['water','long-corridor']){
 const s=story.scenes.find(x=>x.id===id);
 const name=id==='water'?'water-rises-ring-v3.mp4':'corridor-reopens-ring-v3.mp4';
 run(['-i',resolve(media,s.video),'-f','lavfi','-i',`aevalsrc=0.065*(sin(2*PI*440*t)+sin(2*PI*480*t))*lt(mod(t\\,1.1)\\,0.35):s=48000:d=${s.duration}`,
  '-filter_complex','[1:a]afade=t=in:d=0.03,afade=t=out:st=1.8:d=0.35[ring];[0:a][ring]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]',
  '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','160k','-movflags','+faststart',output(name)]);
 s.video=name;
}
writeFileSync(path,JSON.stringify(story,null,2)+'\n');
console.log('Check-In recut and two telephone-ring mixes completed; all input files preserved.');
