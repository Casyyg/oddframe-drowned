import {readFileSync,rmSync,mkdirSync,copyFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const story=JSON.parse(readFileSync(resolve(root,'public/media/drowned/story.json'),'utf8'));
// Only the generated media output is replaced; source media and databases are untouched.
rmSync(resolve(root,'dist/client/media'),{recursive:true,force:true});
mkdirSync(resolve(root,'dist/client/media/drowned'),{recursive:true});
for(const file of new Set(['story.json',...story.scenes.flatMap(s=>[s.video,s.poster,s.captions]).filter(Boolean)])) {
  if(file.includes('/')||file.includes('..'))throw new Error('Unexpected media path');
  if(statSync(resolve(root,'public/media/drowned',file)).size>8*1024*1024)throw new Error('Preview media exceeds the bounded range-response limit');
  copyFileSync(resolve(root,'public/media/drowned',file),resolve(root,'dist/client/media/drowned',file));
}
