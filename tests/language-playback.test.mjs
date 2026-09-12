import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
register('./tsx-loader.mjs', import.meta.url);
const { translate, localizeView, catalog, isLanguage, languageLocales } = await import('../lib/localization.tsx');
const { playWithSound } = await import('../lib/sound-playback.ts');
const { createRequestId, prepareEvent } = await import('../lib/request-id.ts');
const { LanguageProvider, LanguagePicker } = await import('../components/language-provider.tsx');

test('Language: default is English and exactly three supported choices are rendered', () => {
  const markup = renderToStaticMarkup(h(LanguageProvider,null,h(LanguagePicker)));
  assert.ok(markup.includes('English')); assert.ok(markup.includes('Language'));
  assert.deepEqual(Object.keys(languageLocales),['en','zh','mn']);
  assert.equal(isLanguage('en'),true); assert.equal(isLanguage('zh'),true); assert.equal(isLanguage('mn'),true); assert.equal(isLanguage('fr'),false); assert.equal(isLanguage(null),false);
});
test('LAN HTTP: create valid event IDs without crypto.randomUUID', () => {
  let sequence = 0;
  const random = { getRandomValues(bytes) { bytes.fill(++sequence); return bytes; } };
  assert.equal(random.randomUUID, undefined);
  const first = createRequestId(random), second = createRequestId(random);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
});
test('LAN HTTP: failed preparation retains the draft and retry keeps its ID', () => {
  const draft = { sceneId: 'opening', type: 'complete' };
  assert.throws(() => prepareEvent(draft, {}), /Could not prepare your action/);
  assert.deepEqual(draft, {sceneId:'opening',type:'complete'});
  const random = { getRandomValues(bytes) { return bytes.fill(16); } };
  assert.equal(prepareEvent(draft, random), draft);
  const id = draft.requestId;
  assert.equal(prepareEvent(draft, {}).requestId, id, 'retry must not generate a second ID');
});
test('LAN HTTP: use browser entropy and translate all mobile save/retry states', () => {
  assert.notEqual(createRequestId(), createRequestId());
  for (const text of ['Story actions','Action not saved','Watch the scene','View ending','Could not prepare your action. Please retry.']) {
    for (const language of ['zh','mn']) assert.notEqual(translate(text,language),text);
  }
  for(const file of ['app/drowned/page.tsx']) {
    const source = readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(!source.includes('crypto.randomUUID'));
    assert.ok(source.includes('prepareEvent('));
  }
});
test('Language: catalog has complete Chinese and Mongolian translations', () => {
  for(const [english,translations] of Object.entries(catalog)) {
    assert.equal(translations.length,2,english);
    assert.match(translations[0],/[\u4e00-\u9fff]/u,english+' Chinese');
    assert.match(translations[1],/[\u0400-\u04ff]/u,english+' Mongolian');
    assert.equal(translate(english,'en'),english);
  }
});
test('Language: every story scene, choice, dialogue, clue and production note is translated', () => {
  for(const file of ['drowned/story.json','story.json']) {
    const story = JSON.parse(readFileSync(new URL('../public/media/'+file,import.meta.url),'utf8'));
    for(const scene of story.scenes) {
      const strings = [scene.title,scene.chapter,scene.clue,scene.productionNote,...(scene.text??[]),...(scene.dialogue??[]).flatMap(d=>[d.speaker,d.line]),...scene.choices.map(c=>c.label)].filter(Boolean);
      for(const text of strings) for(const lang of ['zh','mn']) assert.notEqual(translate(text,lang),text,text+' in '+lang);
    }
  }
});
test('Language: all static page text translates, except product name and fixed clock', () => {
  for(const file of ['app/page.tsx','app/drowned/page.tsx','app/insights/page.tsx']) {
    const source = ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function walk(node) {
      if(ts.isJsxText(node)) {
        const text = node.text.replace(/\s+/g,' ').trim();
        if(/[a-z]/i.test(text) && !['ODDFRAME','11:47 PM'].includes(text)) for(const lang of ['zh','mn']) assert.notEqual(translate(text,lang),text,file+': '+text);
      }
      ts.forEachChild(node,walk);
    }
    walk(source);
  }
});
test('Language: translated views retain video identity, state, URLs and event handlers', () => {
  const onClick = () => 'unchanged'; const ref = {current:null};
  const source = h('div',null,h('video',{key:'phone',src:'/media/drowned/phone.mp4',ref,'aria-label':'Story video'}),h('button',{onClick},'Answer the emergency phone'),h('code',null,'secret-session-id'));
  for(const language of ['zh','mn']) {
    const result = localizeView(source,language);
    assert.equal(result.props.children[0].key,'phone'); assert.equal(result.props.children[0].props.src,'/media/drowned/phone.mp4'); assert.equal(result.props.children[0].props.ref,ref);
    assert.equal(result.props.children[1].props.onClick,onClick); assert.equal(result.props.children[2].props.children,'secret-session-id');
    const markup = renderToStaticMarkup(result); assert.ok(!markup.includes('Answer the emergency phone')); assert.ok(markup.includes('secret-session-id'));
  }
  assert.equal(translate('  ','zh'),'  ');
  assert.equal(translate('Unknown project ID 123','mn'),'Unknown project ID 123');
});
test('Language: dynamic ending labels and combined server errors translate', () => {
  for(const language of ['zh','mn']) {
    assert.ok(!translate('Nameless Ending',language).includes('Nameless'));
    const text = translate('The story could not be saved. Please retry. Your action has not been confirmed. Retry saving or reload saved progress.',language);
    assert.ok(!/[a-z]{3}/i.test(text));
  }
});
test('Playback: unmute and call play; restore a zero volume', async () => {
  const fake = {muted:true,volume:0,calls:0,play(){this.calls++;assert.equal(this.muted,false);assert.equal(this.volume,1);return Promise.resolve();}};
  await playWithSound(fake); assert.equal(fake.calls,1);
});
test('Playback: preserve an existing nonzero volume', async () => {
  const fake = {muted:true,volume:0.35,play(){return Promise.resolve();}};
  await playWithSound(fake); assert.equal(fake.muted,false); assert.equal(fake.volume,0.35);
});
test('Playback: surface browser rejection so the player can show a real click fallback', async () => {
  const error = new Error('User interaction required'); error.name = 'NotAllowedError';
  const fake = {muted:true,volume:1,play(){return Promise.reject(error);}};
  await assert.rejects(playWithSound(fake), e=>e===error);
});
test('Playback: the remaining story player uses autoplay and an explicit sound fallback', () => {
  for(const file of ['app/drowned/page.tsx']) {
    const source = readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(source.includes('useSoundAutoplay')); assert.ok(source.includes('autoPlay'));
    assert.ok(source.includes('autoplay.play')); assert.ok(source.includes('Play with sound'));
  }
  const hook = readFileSync(new URL('../lib/use-sound-autoplay.ts',import.meta.url),'utf8');
  assert.ok(hook.includes('[ref,sceneId,enabled]')); assert.ok(!hook.includes('language'));
});
