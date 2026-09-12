import {existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const ffmpeg='/Users/casgao/Desktop/SPI/615/Ass4/work/oddframe/deps/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1';
const media=resolve('public/media/drowned');
const evidence=resolve('evidence/revision-2026-09-10');
mkdirSync(evidence,{recursive:true});
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);}
// Label the metal above the button: no moving finger crosses this area.
// Derive the poster from the finished video so the label cannot disappear on play.
const output=resolve(media,'press-b13-v2.mp4');
if(existsSync(output)) throw new Error('Revision output already exists; preserve it and choose a new revision.');
run(['-i',resolve(media,'press-b13.mp4'),'-vf',"drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial Bold.ttf':text='B13':fontsize=80:fontcolor=0xe7d5a8:shadowcolor=0x101714:shadowx=2:shadowy=3:x=w*0.475-text_w/2:y=h*0.22",'-c:v','libx264','-crf','18','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output]);
run(['-i',output,'-frames:v','1','-q:v','2',resolve(media,'button-v2.jpeg')]);
run(['-i',output,'-vf','fps=1,scale=180:320,tile=4x2','-frames:v','1',resolve(evidence,'button-v2-overview.jpg')]);
console.log('Created opening revision and matching poster; originals preserved.');
