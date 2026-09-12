import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../server/store.mjs';
import { makeServer } from '../server/index.mjs';
import { startSession, getSession, statistics } from '../server/game.mjs';
import {
  drownedStory,
  startDrowned,
  getDrowned,
  mutateDrowned,
  drownedStats,
} from '../server/drowned.mjs';
const fresh = () => createStore({ path: ':memory:' });
const event = async (store, s, type, extra = {}) => ({
  ...(await mutateDrowned(store, s.token, {
    requestId: randomUUID(),
    sceneId: s.sceneId,
    type,
    ...extra,
  })),
  token: s.token,
});
async function finish(store, s, mode = 'video') {
  if (!s.scene.video || mode === 'text') return event(store, s, 'read');
  s = await event(store, s, 'play', { position: 0 });
  return event(store, s, 'complete', { position: s.scene.duration });
}
async function choose(store, s, choiceId) {
  return event(store, s, 'choice', { choiceId });
}
async function reachRegister(store, detour = false, mode = 'video') {
  let s = await startDrowned(store);
  for (const choice of [
    'descend',
    'look',
    ...(detour ? ['close', 'wait', 'answer'] : ['answer']),
    'register',
  ]) {
    s = await finish(store, s, mode);
    s = await choose(store, s, choice);
  }
  return finish(store, s, mode);
}
for (const detour of [false, true]) {
  for (const ending of ['Check-In', 'Surface', 'Nameless']) {
    test(`Drowned: ${ending} ending via ${detour ? 'closed doors' : 'direct phone'} route`, async () => {
      const store = await fresh();
      try {
        let s = await reachRegister(store, detour);
        assert.equal(s.clues.length, 3);
        assert.equal(s.phone, 'connected');
        if (ending === 'Nameless') {
          s = await event(store, s, 'line', { value: false });
          s = await choose(store, s, 'erase');
          s = await finish(store, s);
          s = await choose(store, s, 'return');
        } else
          s = await choose(
            store,
            s,
            ending === 'Check-In' ? 'check-in' : 'surface',
          );
        assert.equal(s.ending, null);
        s = await finish(store, s);
        assert.equal(s.ending, ending);
        const raw = await getDrowned(store, s.token);
        assert.equal(raw.events.filter((e) => e.type === 'ending').length, 1);
        assert.equal(
          raw.events.filter((e) => e.type === 'phone_call').length,
          1,
        );
        assert.equal(s.lineOpen, ending !== 'Nameless');
      } finally {
        store.close();
      }
    });
  }
}
test('Drowned: every route is playable as text; skips are not video views', async () => {
  const store = await fresh();
  try {
    let s = await reachRegister(store, true, 'text');
    s = await choose(store, s, 'check-in');
    s = await finish(store, s, 'text');
    const stats = await drownedStats(store);
    assert.equal(stats.completed, 1);
    assert.equal(stats.plays, 0);
    assert.equal(stats.completedClips, 0);
    const visited = ['button','doors','water','closing','long-corridor','phone','register','check-in']
      .map(id => drownedStory.scenes.find(scene => scene.id === id));
    assert.equal(stats.skippedClips, visited.filter(scene => scene.video).length);
    assert.equal(stats.placeholders, visited.filter(scene => !scene.video).length);
  } finally {
    store.close();
  }
});
test('Drowned: missing clips cannot emit playback; choices require acknowledgement', async () => {
  const store = await fresh();
  // Exercise the fallback independently of the production inventory, which is now complete.
  const fixture = drownedStory.scenes.find(scene => scene.id === 'long-corridor');
  const original = {video: fixture.video, poster: fixture.poster, duration: fixture.duration};
  Object.assign(fixture, {video:null, poster:null, duration:null});
  try {
    let s = await startDrowned(store);
    await assert.rejects(choose(store, s, 'descend'), (e) => e.status === 409);
    await assert.rejects(
      event(store, s, 'complete', { position: 8 }),
      (e) => e.status === 409,
    );
    for (const choice of ['descend','look','close','wait']) {
      s = await finish(store, s);
      s = await choose(store, s, choice);
    }
    assert.equal(s.sceneId, 'long-corridor');
    assert.equal(s.scene.video, null);
    await assert.rejects(
      event(store, s, 'play', { position: 0 }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      event(store, s, 'complete', { position: 1 }),
      (e) => e.status === 400,
    );
    assert.equal((await drownedStats(store)).completedClips, 4);
  } finally {
    Object.assign(fixture, original);
    store.close();
  }
});
test('Drowned: mute is required, reversible, and restricted to the connected phone', async () => {
  const store = await fresh();
  try {
    const first = await startDrowned(store);
    await assert.rejects(
      event(store, first, 'line', { value: false }),
      (e) => e.status === 409,
    );
    let s = await reachRegister(store);
    await assert.rejects(choose(store, s, 'erase'), (e) => e.status === 409);
    await assert.rejects(
      event(store, s, 'line', { value: 'false' }),
      (e) => e.status === 400,
    );
    s = await event(store, s, 'line', { value: false });
    s = await event(store, s, 'line', { value: true });
    await assert.rejects(choose(store, s, 'erase'), (e) => e.status === 409);
    s = await event(store, s, 'line', { value: false });
    s = await choose(store, s, 'erase');
    await assert.rejects(
      event(store, s, 'line', { value: true }),
      (e) => e.status === 409,
    );
    assert.equal((await drownedStats(store)).switches, 3);
  } finally {
    store.close();
  }
});
test('Drowned: duplicate/concurrent retries create one choice and one ending', async () => {
  const store = await fresh();
  try {
    let s = await reachRegister(store);
    const body = {
      requestId: randomUUID(),
      sceneId: s.sceneId,
      type: 'choice',
      choiceId: 'surface',
    };
    await Promise.all([
      mutateDrowned(store, s.token, body),
      mutateDrowned(store, s.token, body),
    ]);
    s = { ...(await mutateDrowned(store, s.token, body)), token: s.token };
    s = await finish(store, s);
    await event(store, s, 'read');
    const raw = await getDrowned(store, s.token);
    assert.equal(
      raw.events.filter((e) => e.type === 'choice' && e.choiceId === 'surface')
        .length,
      1,
    );
    assert.equal(raw.events.filter((e) => e.type === 'ending').length, 1);
  } finally {
    store.close();
  }
});
test('Drowned: stale scenes, invalid choices, positions and bodies are rejected', async () => {
  const store = await fresh();
  try {
    let s = await startDrowned(store);
    const original = { ...s };
    await assert.rejects(
      event(store, s, 'seek', { position: -1 }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      event(store, s, 'seek', { position: Infinity }),
      (e) => e.status === 400,
    );
    await assert.rejects(
      mutateDrowned(store, s.token, null),
      (e) => e.status === 400,
    );
    s = await finish(store, s);
    await assert.rejects(choose(store, s, 'nameless'), (e) => e.status === 400);
    s = await choose(store, s, 'descend');
    await assert.rejects(
      event(store, original, 'read'),
      (e) => e.status === 409,
    );
  } finally {
    store.close();
  }
});
test('Drowned: SQLite persists progress and line state through reopening', async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'drowned-test-')),
    'sessions.sqlite',
  );
  let store = await createStore({ path });
  let s = await reachRegister(store);
  s = await event(store, s, 'line', { value: false });
  store.close();
  store = await createStore({ path });
  try {
    const saved = await getDrowned(store, s.token);
    assert.equal(saved.sceneId, 'register');
    assert.equal(saved.lineOpen, false);
    assert.equal(saved.ready, true);
  } finally {
    store.close();
  }
});
test('Drowned: mother sessions and analytics stay isolated; no full bearer tokens in stats', async () => {
  const store = await fresh();
  try {
    const mother = await startSession(store);
    const drowned = await startDrowned(store);
    await assert.rejects(
      getDrowned(store, mother.token),
      (e) => e.status === 404,
    );
    await assert.rejects(
      getSession(store, drowned.token),
      (e) => e.status === 404,
    );
    const a = await drownedStats(store);
    const b = await statistics(store);
    assert.equal(a.sessions, 1);
    assert.equal(b.sessions, 1);
    assert.ok(!JSON.stringify(a).includes(drowned.token));
    assert.ok(!JSON.stringify(b).includes(mother.token));
  } finally {
    store.close();
  }
});
test('Drowned: expired sessions are unavailable and excluded from stats', async () => {
  const store = await fresh();
  try {
    const s = await startDrowned(store);
    const raw = await getDrowned(store, s.token);
    await store.put({ ...raw, version: 1, expiresAt: 1 }, 0);
    await assert.rejects(getDrowned(store, s.token), (e) => e.status === 404);
    assert.equal((await drownedStats(store)).sessions, 0);
  } finally {
    store.close();
  }
});
test('Drowned: graph has exactly three reachable endings and honest pending assets', () => {
  const scenes = new Map(drownedStory.scenes.map((s) => [s.id, s]));
  const seen = new Set();
  function visit(id, stack = new Set()) {
    assert.ok(scenes.has(id));
    assert.ok(!stack.has(id), 'Story graph must terminate');
    seen.add(id);
    const scene = scenes.get(id);
    for (const choice of scene.choices)
      visit(choice.next, new Set([...stack, id]));
  }
  visit(drownedStory.startSceneId);
  assert.equal(seen.size, scenes.size);
  assert.deepEqual(
    drownedStory.scenes
      .filter((s) => s.ending)
      .map((s) => s.ending)
      .sort((a,b)=>a.localeCompare(b)),
    ['Check-In', 'Nameless', 'Surface'],
  );
  for (const s of scenes.values()) {
    if (s.video) {
      assert.ok(s.duration > 0);
      assert.ok(
        existsSync(
          new URL('../public/media/drowned/' + s.video, import.meta.url),
        ),
      );
    } else {
      assert.equal(s.video, null);
      assert.equal(s.duration, null);
      assert.equal(s.poster, null);
      assert.ok(s.productionNote);
    }
  }
  assert.ok(!/[\u4e00-\u9fff]/u.test(JSON.stringify(drownedStory)));
});
test('Drowned: HTTP persistence, admin protection, media range and JPEG types', async () => {
  const store = await fresh();
  const adminToken = 'test-only-admin-token-0123456789abcdef';
  const server = await makeServer({ store, production: true, adminToken });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const request = (path, options) => fetch(origin + path, options);
    assert.equal((await request('/api/drowned/stats')).status, 401);
    assert.equal(
      (
        await request('/api/drowned/stats', {
          headers: { Authorization: 'Bearer ' + adminToken },
        })
      ).status,
      200,
    );
    const result = await request('/api/drowned/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({playerName:'HTTP test player'}),
    });
    assert.equal(result.status, 201);
    const session = await result.json();
    const headers = {
      Authorization: 'Bearer ' + session.token,
      'Content-Type': 'application/json',
    };
    assert.equal(
      (
        await request('/api/drowned/events', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            requestId: randomUUID(),
            sceneId: session.sceneId,
            type: 'read',
          }),
        })
      ).status,
      200,
    );
    assert.equal(
      (await (await request('/api/drowned/session', { headers })).json()).ready,
      true,
    );
    const openingClip = drownedStory.scenes.find((scene) => scene.id === drownedStory.startSceneId).video;
    const media = await request('/media/drowned/' + openingClip, {
      headers: { Range: 'bytes=0-1023' },
    });
    assert.equal(media.status, 206);
    assert.equal((await media.arrayBuffer()).byteLength, 1024);
    const routedMedia=await request('/api/media/drowned/' + openingClip,{headers:{Range:'bytes=0-1023'}});
    assert.equal(routedMedia.status,206);
    assert.equal((await routedMedia.arrayBuffer()).byteLength,1024);
    const poster = await request('/media/drowned/corridor.jpeg', {
      method: 'HEAD',
    });
    assert.equal(poster.headers.get('content-type'), 'image/jpeg');
    assert.equal((await request('/media/drowned/long-corridor.mp4')).status, 404);
    for (const name of ['register','erase','nameless']) {
      const filename = drownedStory.scenes.find((scene) => scene.id === name).video;
      const clip = await request(`/media/drowned/${filename}`, { headers: { Range: 'bytes=0-1023' } });
      assert.equal(clip.status, 206);
      assert.equal(clip.headers.get('content-type'), 'video/mp4');
      assert.equal((await clip.arrayBuffer()).byteLength, 1024);
    }
    for (const path of ['/api/drowned/events', '/api/drowned/sessions'])
      assert.equal(
        (
          await request(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: 'null',
          })
        ).status,
        400,
      );
  } finally {
    await new Promise((r) => server.close(r));
  }
});
test('Drowned: player and dashboard source stay English and do not request device access', () => {
  for (const file of [
    'app/page.tsx',
    'app/drowned/page.tsx',
    'app/insights/page.tsx',
  ]) {
    const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.ok(!/[\u4e00-\u9fff]/u.test(text));
    assert.ok(!text.includes('getUserMedia'));
  }
});
