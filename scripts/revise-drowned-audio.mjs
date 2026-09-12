import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const ffmpeg='/Users/casgao/Desktop/SPI/615/Ass4/work/oddframe/deps/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';
const evidence=resolve('evidence/revision-2026-09-10');
const media=resolve('public/media/drowned');
mkdirSync(evidence,{recursive:true});
const manifestPath=resolve(media,'story.json');
const story=JSON.parse(readFileSync(manifestPath,'utf8'));
const jobs=['doors','water','closing','phone','register','check-in','surface','erase'];
function run(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',maxBuffer:8*1024*1024});if(r.status)throw new Error(r.stderr);return r;}
function duration(file){const r=run(ffmpeg,['-hide_banner','-i',file,'-f','null','-']);const m=/Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr);if(!m)throw new Error('Missing duration');return +m[1]*3600 + +m[2]*60 + +m[3];}
function stamp(value){return new Date(Math.round(value*1000)).toISOString().slice(11,23);}
const results=[];
for(const id of jobs){
  const scene=story.scenes.find(s=>s.id===id);
  const input=resolve(media,scene.video);
  const name=scene.video.replace('.mp4','-sound-v2.mp4');
  const output=resolve(media,name);
  if(existsSync(output)) throw new Error('Output exists: '+output);
  const speech=scene.dialogue.map(d=>d.line).join(' ');
  const voice=id==='closing'?'Karen':id==='phone'||id==='surface'||id==='check-in'?'Eddy (英语（美国）)':'Daniel';
  const spokenFile=resolve(evidence,id+'-voice.aiff');
  let spoken=0;
  if(speech){run('/usr/bin/say',['-v',voice,'-r',id==='phone'?'155':'145','-o',spokenFile,speech]);spoken=duration(spokenFile);}
  const length=Math.ceil(Math.max(scene.duration,spoken+1.0)*24)/24;
  const inputs=['-i',input,'-f','lavfi','-i',`anoisesrc=color=brown:amplitude=0.09:sample_rate=48000:duration=${length}`];
  if(speech)inputs.push('-i',spokenFile);
  const ambience=id==='water'?'highpass=f=220,lowpass=f=1800':id==='closing'?'highpass=f=45,lowpass=f=600':id==='erase'?'highpass=f=500,lowpass=f=2200':'highpass=f=45,lowpass=f=320';
  const filters=[`[1:a]${ambience},afade=t=in:d=0.18,afade=t=out:st=${Math.max(0,length-0.35)}:d=0.35[room]`];
  if(speech){filters.push(`[2:a]${id==='phone'?'highpass=f=320,lowpass=f=2800,':'highpass=f=100,'}loudnorm=I=-19:TP=-2:LRA=7,adelay=500|500,apad[voice]`);filters.push('[room][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]');}
  else filters.push('[room]alimiter=limit=0.89[a]');
  const args=['-hide_banner','-nostdin',...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[a]'];
  if(length>scene.duration+0.04)args.push('-vf',`tpad=stop_mode=clone:stop_duration=${length-scene.duration}`,'-c:v','libx264','-crf','18','-pix_fmt','yuv420p');
  else args.push('-c:v','copy');
  args.push('-t',String(length),'-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',output);
  run(ffmpeg,args);
  scene.video=name; scene.duration=+length.toFixed(4);
  if(speech){const captions=id+'-en-v2.vtt';writeFileSync(resolve(media,captions),`WEBVTT\n\n00:00:00.500 --> ${stamp(Math.min(length,spoken+0.5))}\n${speech}\n`);scene.captions=captions;}
  if(scene.productionNote)scene.productionNote='Revised picture edit with English synthetic dialogue where scripted and added ambience. Final listening review remains required.';
  results.push({scene:id,input:input.split('/').at(-1),output:name,duration:scene.duration,speech,voice:speech?voice:null,originalPreserved:true});
}
writeFileSync(manifestPath,JSON.stringify(story,null,2)+'\n');
writeFileSync(resolve(evidence,'audio-revisions.json'),JSON.stringify({at:new Date().toISOString(),method:'Local synthetic English voices and procedural room ambience. Not a voice clone or certified listening pass.',results},null,2));
console.log(results);
