import { randomBytes } from 'node:crypto';
import { ApiError } from './errors.mjs';
import story from '../public/media/drowned/story.json' with { type: 'json' };
export const drownedStory = story;
const scenes = new Map(drownedStory.scenes.map((scene) => [scene.id, scene]));
const now = () => new Date().toISOString();
const fail = (status, message) => {
  throw new ApiError(status, message);
};
function event(s, type, detail = {}) {
  s.events.push({
    number: s.events.length + 1,
    at: now(),
    sceneId: s.sceneId,
    type,
    ...detail,
  });
}
export function publicDrowned(s) {
  return {
    storyId: s.storyId,
    playerName: s.playerName ?? null,
    sceneId: s.sceneId,
    scene: scenes.get(s.sceneId),
    version: s.version,
    ready: s.ready,
    lineOpen: s.lineOpen,
    phone: s.phone,
    ending: s.ending,
    clues: s.clues,
    visited: s.visited,
    updatedAt: s.updatedAt,
  };
}
export function validatePlayerName(value) {
  if (typeof value !== 'string') fail(400, 'Enter a player name (1–40 characters).');
  const name = value.normalize('NFC').trim();
  if (!name || [...name].length > 40 || /[<>\p{Cc}\p{Cf}]/u.test(name))
    fail(400, 'Enter a player name (1–40 characters).');
  return name;
}
export async function startDrowned(store, playerName = null) {
  const s = {
    id: randomBytes(32).toString('hex'),
    storyId: drownedStory.id,
    playerName: playerName === null ? null : validatePlayerName(playerName),
    version: 0,
    sceneId: drownedStory.startSceneId,
    ready: false,
    started: false,
    lineOpen: false,
    phone: 'idle',
    ending: null,
    clues: [],
    visited: [drownedStory.startSceneId],
    events: [],
    requests: [],
    createdAt: now(),
    updatedAt: now(),
    expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400,
  };
  event(s, 'session_start');
  await store.put(s, null);
  return { token: s.id, ...publicDrowned(s) };
}
export async function getDrowned(store, token) {
  if (!/^[a-f0-9]{64}$/.test(token ?? ''))
    fail(401, 'Start a story to create a session.');
  const s = await store.get(token);
  if (!s || s.storyId !== drownedStory.id || s.expiresAt < Date.now() / 1000)
    fail(404, 'This story session is unavailable. Start a new session.');
  return s;
}
function finish(s, scene, mode) {
  s.ready = true;
  if (scene.clue && !s.clues.includes(scene.clue)) s.clues.push(scene.clue);
  if (scene.id === 'phone' && s.phone === 'idle') {
    s.phone = 'connected';
    s.lineOpen = true;
    event(s, 'phone_call', { state: 'connected' });
  }
  if (scene.ending) {
    s.ending = scene.ending;
    event(s, 'ending', { ending: s.ending, lineOpen: s.lineOpen, mode });
  }
}
export async function mutateDrowned(store, token, body) {
  if (
    !body ||
    typeof body !== 'object' ||
    !/^[-a-zA-Z0-9]{8,80}$/.test(body.requestId ?? '')
  )
    fail(400, 'A valid request ID is required.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const s = await getDrowned(store, token);
    if (s.requests.includes(body.requestId)) return publicDrowned(s);
    if (s.events.length >= 400)
      fail(429, 'Session event limit reached. Start a new session.');
    if (body.sceneId !== s.sceneId)
      fail(409, 'The story has moved on. Reload your saved progress.');
    const scene = scenes.get(s.sceneId);
    const previous = s.version;
    if (['play', 'pause', 'seek', 'complete'].includes(body.type)) {
      if (!scene.video)
        fail(400, 'This shot has no video yet. Use the story-text option.');
      if (
        typeof body.position !== 'number' ||
        !Number.isFinite(body.position) ||
        body.position < 0 ||
        body.position > scene.duration + 1
      )
        fail(400, 'Invalid playback position.');
      if (body.type === 'complete') {
        if (!s.started || body.position < scene.duration - 0.75)
          fail(409, 'Play the clip to its end, or choose Read instead.');
        if (!s.ready) {
          event(s, 'play_complete', { position: body.position });
          finish(s, scene, 'video');
        }
      } else {
        if (body.type === 'play') s.started = true;
        event(s, body.type, { position: body.position });
      }
    } else if (body.type === 'read') {
      if (!s.ready) {
        event(s, scene.video ? 'video_skipped' : 'placeholder_read');
        finish(s, scene, 'text');
      }
    } else if (body.type === 'line') {
      if (
        !['phone', 'register'].includes(scene.id) ||
        !s.ready ||
        s.phone === 'idle' ||
        s.ending
      )
        fail(409, 'The emergency line is not available here yet.');
      if (typeof body.value !== 'boolean')
        fail(400, 'The line state must be on or off.');
      if (s.lineOpen !== body.value) {
        s.lineOpen = body.value;
        event(s, 'switch', { control: 'emergency_line', value: s.lineOpen });
      }
    } else if (body.type === 'choice') {
      if (!s.ready || s.ending)
        fail(409, 'Finish this scene before making a choice.');
      const choice = scene.choices.find((c) => c.id === body.choiceId);
      if (!choice) fail(400, 'That choice is not available here.');
      if (choice.requiresMuted && s.lineOpen)
        fail(409, 'Silence the emergency line before erasing your name.');
      event(s, 'choice', {
        choiceId: choice.id,
        label: choice.label,
        nextSceneId: choice.next,
      });
      s.sceneId = choice.next;
      s.ready = false;
      s.started = false;
      s.visited.push(s.sceneId);
    } else fail(400, 'Unknown event type.');
    s.version++;
    s.updatedAt = now();
    s.requests.push(body.requestId);
    if (await store.put(s, previous)) return publicDrowned(s);
  }
  fail(409, 'Another action is being saved. Please retry.');
}
export async function drownedStats(store) {
  const { items: raw, truncated } = await store.list(500);
  const items = raw.filter(
    (s) => s.storyId === drownedStory.id && s.expiresAt >= Date.now() / 1000,
  );
  const events = items.flatMap((s) => s.events);
  const count = (type) => events.filter((e) => e.type === type).length;
  const endings = Object.fromEntries(
    ['Check-In', 'Surface', 'Nameless'].map((name) => [
      name,
      items.filter((s) => s.ending === name).length,
    ]),
  );
  return {
    generatedAt: now(),
    storage: store.name,
    storyId: drownedStory.id,
    scope: truncated
      ? 'Sampled from up to 500 sessions; not all-time totals.'
      : 'All retained sessions for this story. Records expire after 30 days.',
    sampled: truncated,
    sessions: items.length,
    completed: items.filter((s) => s.ending).length,
    plays: count('play'),
    completedClips: count('play_complete'),
    choices: count('choice'),
    switches: count('switch'),
    skippedClips: count('video_skipped'),
    placeholders: count('placeholder_read'),
    endings,
    media: {
      available: drownedStory.scenes.filter((s) => s.video).length,
      pending: drownedStory.scenes
        .filter((s) => !s.video)
        .map((s) => ({ id: s.id, title: s.title, note: s.productionNote })),
    },
    recent: items
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 20)
      .map((s) => ({
        session: s.id.slice(0, 8),
        playerName: s.playerName ?? null,
        scene: scenes.get(s.sceneId).title,
        ending: s.ending,
        lineOpen: s.lineOpen,
        phone: s.phone,
        updatedAt: s.updatedAt,
        timeline: s.events.slice(-15),
      })),
  };
}
