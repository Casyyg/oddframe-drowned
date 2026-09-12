'use client';
/* oxlint-disable next/no-html-link-for-pages -- Full page navigation intentionally triggers the unsaved-event unload guard in this static export. */
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Film, Phone, Volume2 } from 'lucide-react';
import { LanguagePicker, useLanguage } from '@/components/language-provider';
import { useSoundAutoplay } from '@/lib/use-sound-autoplay';
import { prepareEvent } from '@/lib/request-id';
import { Switch } from '@/components/ui/switch';
import {
  drownedApi,
  RequestError,
  type DrownedSession,
} from '@/lib/drowned-client';

const storageKey = 'oddframe-drowned-session-v1';
type PendingEvent = {
  requestId?: string;
  sceneId: string;
  type: string;
  [key: string]: unknown;
};
export default function Drowned() {
  const {view} = useLanguage();
  const [session, setSession] = useState<DrownedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [failedScene, setFailedScene] = useState('');
  const [hasPending, setHasPending] = useState(false);
  const [restart, setRestart] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const token = useRef('');
  const current = useRef<DrownedSession | null>(null);
  const queue = useRef<PendingEvent[]>([]);
  const running = useRef(false);
  const blocked = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const decisions = useRef<HTMLDivElement>(null);
  const endingPanel = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const starting = useRef(false);
  const autoplay = useSoundAutoplay(video, session?.sceneId, !!session?.scene.video && !loading);

  function accept(next: DrownedSession) {
    current.current = next;
    if (mounted.current) setSession(next);
  }
  async function restore() {
    if (running.current) return;
    setLoading(true);
    setError('');
    queue.current = [];
    setHasPending(false);
    blocked.current = false;
    try {
      if (token.current) accept(await drownedApi('session', token.current));
    } catch (e) {
      if (e instanceof RequestError && [401, 404].includes(e.status)) {
        token.current = '';
        current.current = null;
        setSession(null);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Browsing without persistent storage is supported. */
        }
        setNotice(
          'Your previous session is unavailable. You can start a new story.',
        );
      } else setError((e as Error).message);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    // Browser-only persistence is restored after hydration, never during static rendering.
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        token.current = localStorage.getItem(storageKey) ?? '';
      } catch {
        setNotice(
          'Browser storage is unavailable. Progress will last for this open page only.',
        );
      }
      void restore();
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [session?.sceneId]);
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (queue.current.length) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  async function begin() {
    if (running.current || starting.current) return;
    const name = (playerName || current.current?.playerName || '').trim();
    if (!name) { current.current = null; setSession(null); setRestart(false); return; }
    starting.current = true;
    video.current?.pause();
    setLoading(true);
    setError('');
    setRestart(false);
    queue.current = [];
    setHasPending(false);
    blocked.current = false;
    try {
      const next = await drownedApi('sessions', undefined, { playerName: name });
      token.current = next.token!;
      accept(next);
      try {
        localStorage.setItem(storageKey, token.current);
      } catch {
        setNotice(
          'Browser storage is unavailable. Keep this page open to retain access to this session.',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      starting.current = false;
      setLoading(false);
    }
  }
  async function flush() {
    if (running.current || blocked.current) return;
    running.current = true;
    setSaving(true);
    try {
      while (queue.current.length) {
        const next = await drownedApi(
          'events',
          token.current,
          prepareEvent(queue.current[0]),
        );
        queue.current.shift();
        accept(next);
      }
      setError('');
      setHasPending(false);
    } catch (e) {
      blocked.current = true;
      video.current?.pause();
      setError(
        (e as Error).message +
          ' Your action has not been confirmed. Retry saving or reload saved progress.',
      );
    } finally {
      running.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  function send(
    type: string,
    extra: Record<string, unknown> = {},
    sceneId = current.current?.sceneId,
  ) {
    if (
      starting.current ||
      !sceneId ||
      sceneId !== current.current?.sceneId ||
      !token.current
    )
      return;
    if (
      ['choice', 'read'].includes(type) &&
      queue.current.some((e) => e.sceneId === sceneId && e.type === type)
    )
      return;
    queue.current.push({
      sceneId,
      type,
      ...extra,
    });
    setHasPending(true);
    void flush();
  }
  const scene = session?.scene;
  const disabled = saving || loading || !!error;
  function showPanel(panel: HTMLDivElement | null) {
    panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
    panel?.focus({ preventScroll: true });
  }
  function changePlayer() {
    if(running.current || queue.current.length)return;
    starting.current=true;
    video.current?.pause();
    token.current='';current.current=null;
    setSession(null);setPlayerName('');setError('');setRestart(false);
    try {localStorage.removeItem(storageKey);} catch { /* The old run remains in server statistics. */ }
    starting.current=false;
  }
  return view(
    <div className="drowned-shell">
      <header className="drowned-nav">
        <a className="drowned-brand" href="/">
          ODDFRAME <span>The Drowned Thirteenth Floor</span>
        </a>
        <a href="/insights/">Session insights ↗</a>
        <LanguagePicker/>
      </header>
      <main className="drowned-page">
        {notice && (
          <p className="drowned-note" aria-live="polite">
            {notice}
          </p>
        )}
        {error && (
          <div className="error" role="alert">
            <p>{error}</p>
            <div className="drowned-actions">
              {hasPending && (
                <button
                  className="drowned-button drowned-outline"
                  disabled={saving}
                  onClick={() => {
                    blocked.current = false;
                    void flush();
                  }}
                >
                  Retry saving
                </button>
              )}
              <button
                className="drowned-button drowned-outline"
                disabled={saving}
                onClick={() => void restore()}
              >
                Reload saved progress
              </button>
            </div>
          </div>
        )}
        {loading ? (
          <p className="drowned-muted" aria-live="polite">
            Loading your story…
          </p>
        ) : !session ? (
          <section className="drowned-entry">
            <p className="drowned-kicker">BEFORE YOU BEGIN</p>
            <h1>Before the doors close.</h1>
            <p>
              You are heading home. Your building has twelve floors. Tonight,
              the lift offers B13.
            </p>
            <p className="drowned-muted">
              You play as Alex Morgan. Watch each scene, then choose your way out.
            </p>
            <form className="drowned-name-form" onSubmit={e => { e.preventDefault(); void begin(); }}>
            <label htmlFor="player-name">Player name</label>
            <input id="player-name" name="playerName" required maxLength={40} autoComplete="off" value={playerName} onChange={e => setPlayerName(e.target.value)} aria-describedby="player-name-help"/>
            <p id="player-name-help" className="drowned-small">Use a nickname. Your name and choices are saved for 30 days for the project team to review.</p>
            <button
              className="drowned-button"
              disabled={disabled || !playerName.trim()}
              type="submit"
            >
              Begin story <ArrowRight size={18} />
            </button>
            </form>
          </section>
        ) : (
          scene && (
            <>
              <div className="drowned-scene-heading">
                <div>
                  <p className="drowned-kicker">{scene.chapter}</p>
                  {session.playerName && <p className="drowned-small" data-no-translate>{session.playerName}</p>}
                  <h1 ref={heading} tabIndex={-1}>
                    {scene.title}
                  </h1>
                </div>
                <span className="drowned-save" aria-live="polite">
                  {saving ? 'Saving…' : error ? 'Not synced' : 'Progress saved'}
                </span>
              </div>
              <div className="drowned-player-layout">
                <section
                  aria-label="Story video"
                  className="drowned-screen-column"
                >
                  <div className="drowned-screen">
                    {scene.video ? (
                      // oxlint-disable-next-line jsx-a11y/media-has-caption -- Scripted speech has a conditional English caption track; ambience-only clips use the adjacent transcript.
                      <video
                        key={scene.id}
                        ref={video}
                        controls
                        playsInline
                        autoPlay
                        preload="metadata"
                        poster={
                          scene.poster
                            ? '/media/drowned/' + scene.poster
                            : undefined
                        }
                        aria-label={scene.title + ' video'}
                        aria-describedby="story-transcript"
                        onPlay={(e) =>
                          send(
                            'play',
                            { position: e.currentTarget.currentTime },
                            scene.id,
                          )
                        }
                        onPause={(e) => {
                          if (!e.currentTarget.ended)
                            send(
                              'pause',
                              { position: e.currentTarget.currentTime },
                              scene.id,
                            );
                        }}
                        onSeeked={(e) =>
                          send(
                            'seek',
                            { position: e.currentTarget.currentTime },
                            scene.id,
                          )
                        }
                        onEnded={(e) =>
                          send(
                            'complete',
                            { position: e.currentTarget.currentTime },
                            scene.id,
                          )
                        }
                        onError={() => setFailedScene(scene.id)}
                      >
                        <source
                          src={'/api/media/drowned/' + scene.video}
                          type="video/mp4"
                        />
                        {scene.captions && <track key={scene.captions} kind="captions" src={'/media/drowned/' + scene.captions} srcLang="en" label="English"/>}
                        Your browser cannot play this video. Use Read instead
                        below.
                      </video>
                    ) : (
                      <div className="drowned-placeholder">
                        <Film size={32} strokeWidth={1.2} />
                        <h2>Video pending</h2>
                        <p>This shot has not been generated yet.</p>
                        <span>Read the scene to continue.</span>
                      </div>
                    )}
                    {scene.video && autoplay.blocked && failedScene !== scene.id && (
                      <div className="drowned-sound-overlay" aria-live="polite">
                        <button className="drowned-button" onClick={autoplay.play}>
                          <Volume2 size={17}/> Play with sound
                        </button>
                      </div>
                    )}
                  </div>
                  {failedScene === scene.id && (
                    <p className="drowned-note" role="alert">
                      The video could not load. You can continue using the story
                      text.
                    </p>
                  )}
                  {scene.productionNote && (
                    <details className="drowned-production">
                      <summary>Production note</summary>
                      <p>{scene.productionNote}</p>
                    </details>
                  )}
                </section>
                <section
                  className="drowned-narrative"
                  id="story-transcript"
                  aria-label="Story and dialogue"
                >
                  {scene.text.map((text) => (
                    <p key={text}>{text}</p>
                  ))}
                  {scene.dialogue.map((line, index) => (
                    <blockquote key={index}>
                      <span>{line.speaker}</span>
                      <p>“{line.line}”</p>
                    </blockquote>
                  ))}
                  {!session.ready && (
                    <div className="drowned-read">
                      <p className="drowned-small">
                        {scene.video
                          ? 'Finish the video to unlock your next action, or continue in text mode.'
                          : 'The scene above replaces this missing shot for now.'}
                      </p>
                      <button
                        className="drowned-button drowned-outline"
                        disabled={disabled}
                        onClick={() => {
                          video.current?.pause();
                          send('read');
                        }}
                      >
                        {scene.video ? 'Read instead' : 'Continue with story'}
                      </button>
                    </div>
                  )}
                  <div ref={decisions} tabIndex={-1} className="drowned-decision-panel">
                  {session.phone !== 'idle' &&
                    ['phone', 'register'].includes(scene.id) && (
                      <div className="drowned-line">
                        <div>
                          <label htmlFor="emergency-line">
                            <Phone size={17} /> Emergency line
                          </label>
                          <p id="line-help">
                            {session.lineOpen
                              ? 'Open — the hotel can hear you.'
                              : 'Muted — the line is silent.'}
                          </p>
                        </div>
                        <Switch
                          id="emergency-line"
                          checked={session.lineOpen}
                          disabled={disabled || !session.ready}
                          aria-describedby="line-help"
                          onCheckedChange={(value) => send('line', { value })}
                        />
                      </div>
                    )}
                  {session.ready && !session.ending && (
                    <div
                      className="drowned-choices"
                      aria-label="Choose your next action"
                    >
                      {scene.choices.map((choice) => (
                        <div key={choice.id}>
                          <button
                            className="drowned-choice"
                            disabled={
                              disabled ||
                              !!(choice.requiresMuted && session.lineOpen)
                            }
                            onClick={() =>
                              send('choice', { choiceId: choice.id })
                            }
                          >
                            {choice.label}
                            <ArrowRight size={17} />
                          </button>
                          {choice.requiresMuted && session.lineOpen && (
                            <p className="drowned-small">
                              Silence the emergency line first.
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                  {session.ending && (
                    <div ref={endingPanel} tabIndex={-1} className="drowned-ending" aria-live="polite">
                      <p className="drowned-kicker">ENDING REACHED</p>
                      <h2>{session.ending} Ending</h2>
                      <p className="drowned-muted">
                        Your route has been saved. Different choices lead to
                        three possible endings.
                      </p>
                      <div className="drowned-actions">
                        <button
                          className="drowned-button"
                          disabled={disabled}
                          onClick={() => void begin()}
                        >
                          Try another path
                        </button>
                        <a
                          className="drowned-button drowned-outline"
                          href="/insights/"
                        >
                          View session insights
                        </a>
                      </div>
                    </div>
                  )}
                </section>
              </div>
              <div className="drowned-bottom">
                <details className="drowned-notebook">
                  <summary>
                    Clue notebook <span>{session.clues.length} collected</span>
                  </summary>
                  {session.clues.length ? (
                    <ul>
                      {session.clues.map((clue) => (
                        <li key={clue}>{clue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="drowned-small">
                      Clues appear here as you finish scenes.
                    </p>
                  )}
                </details>
                {!session.ending && (
                  <div>
                    <button
                      className="drowned-text-button"
                      disabled={disabled}
                      onClick={() => setRestart(!restart)}
                    >
                      Start over
                    </button>
                    {restart && (
                      <div className="drowned-note">
                        <p>
                          Start a new session? This browser will resume the new
                          story. Your previous run stays in the statistics.
                        </p>
                        <div className="drowned-actions">
                          <button
                            className="drowned-button"
                            disabled={disabled}
                            onClick={() => void begin()}
                          >
                            Start new session
                          </button>
                          <button
                            className="drowned-button drowned-outline"
                            onClick={() => setRestart(false)}
                          >
                            Keep playing
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )
        )}
      </main>
      {session && scene && !loading && (
        <aside className="drowned-mobile-actions" aria-label="Story actions">
          <p aria-live="polite">{error ? 'Action not saved' : saving ? 'Saving…' : session.ending ? 'ENDING REACHED' : session.ready ? 'Choose your next action' : 'Watch the scene'}</p>
          {error ? (
            <button className="drowned-button" disabled={saving} onClick={() => {
              if (hasPending) { blocked.current = false; void flush(); }
              else void restore();
            }}>Retry saving</button>
          ) : session.ending ? (
            <button className="drowned-button" onClick={() => showPanel(endingPanel.current)}>View ending <ArrowRight size={17}/></button>
          ) : session.ready ? (
            <button className="drowned-button" disabled={disabled} onClick={() => showPanel(decisions.current)}>Choose your next action <ArrowRight size={17}/></button>
          ) : (
            <button className="drowned-button drowned-outline" disabled={disabled} onClick={() => { video.current?.pause(); send('read'); }}>
              {scene.video ? 'Read instead' : 'Continue with story'}
            </button>
          )}
        </aside>
      )}
      <footer className="drowned-footer">
        <a href="/">← Story home</a>
        {session && <button className="drowned-text-button" disabled={disabled} onClick={changePlayer}>Change player</button>}
      </footer>
    </div>
  );
}
