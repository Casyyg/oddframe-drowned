'use client';
/* oxlint-disable next/no-html-link-for-pages -- Use the static export's full page navigation, consistent with the player. */
import { useEffect, useState } from 'react';
import { LanguagePicker, useLanguage } from '@/components/language-provider';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  drownedApi,
  RequestError,
  type DrownedStats,
} from '@/lib/drowned-client';
export default function Insights() {
  const {view,locale} = useLanguage();
  const [stats, setStats] = useState<DrownedStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [accessKey, setAccessKey] = useState('');
  const [locked, setLocked] = useState(false);
  const [exportData, setExportData] = useState('');
  async function refresh(key = accessKey) {
    setLoading(true);
    setError('');
    try {
      setStats(await drownedApi<DrownedStats>('stats', key));
      setLocked(false);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof RequestError && e.status === 401) {
        setLocked(true);
        setStats(null);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void refresh('');
    });
    return () => {
      cancelled = true;
    };
  }, []);
  function download() {
    if (!stats) return;
    const data = JSON.stringify(stats, null, 2);
    setExportData(data);
    const url = URL.createObjectURL(
      new Blob([data], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'drowned-session-insights.json';
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  return view(
    <div className="drowned-shell">
      <header className="drowned-nav">
        <a className="drowned-brand" href="/">
          ODDFRAME <span>Session insights</span>
        </a>
        <a href="/drowned/">Play story →</a>
        <LanguagePicker/>
      </header>
      <main className="drowned-page">
        <div className="drowned-scene-heading">
          <div>
            <p className="drowned-kicker">THE DROWNED THIRTEENTH FLOOR</p>
            <h1>Session insights</h1>
            <p className="drowned-muted">
              Player sessions and choices.
            </p>
          </div>
          <div className="drowned-actions">
            <button
              className="drowned-button drowned-outline"
              disabled={loading}
              onClick={() => void refresh()}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <button
              className="drowned-button"
              disabled={!stats || loading}
              onClick={download}
            >
              Export JSON
            </button>
          </div>
        </div>
        {exportData && (
          <section className="drowned-export-fallback" aria-label="Export data">
            <p aria-live="polite">Download requested. If no file appears, copy the JSON below and save it as a .json file.</p>
            <textarea aria-label="Export data" readOnly value={exportData} onFocus={event => event.currentTarget.select()}/>
            <button className="drowned-text-button" onClick={() => setExportData('')}>Close export</button>
          </section>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {locked && (
          <form
            className="drowned-key-form"
            onSubmit={(e) => {
              e.preventDefault();
              void refresh();
            }}
          >
            <label htmlFor="dashboard-key">Dashboard access key</label>
            <input
              id="dashboard-key"
              type="password"
              autoComplete="off"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
            />
            <button className="drowned-button" disabled={loading}>
              Unlock
            </button>
            <p className="drowned-small">
              Used only for this page. Not saved in browser storage.
            </p>
          </form>
        )}
        {loading && !stats && !locked && (
          <p aria-live="polite" className="drowned-muted">
            Loading recorded sessions…
          </p>
        )}
        {stats && (
          <>
            <div className="drowned-metrics">
              {[
                ['Sessions', stats.sessions],
                ['Endings reached', stats.completed],
                ['Clips completed', stats.completedClips],
                ['Choices made', stats.choices],
              ].map(([name, value]) => (
                <div key={name}>
                  <span>{name}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            <p className="drowned-small">
              Storage: {stats.storage} · Updated{' '}
              {new Date(stats.generatedAt).toLocaleString(locale)}
              <br />
              {stats.scope}
            </p>
            <div className="drowned-insights-grid">
              <section className="drowned-panel">
                <h2>Three ways out</h2>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ending</TableHead>
                      <TableHead>Sessions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(stats.endings).map(([ending, count]) => (
                      <TableRow key={ending}>
                        <TableCell>{ending}</TableCell>
                        <TableCell>{count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="drowned-small">
                  An ending is counted after its final scene is watched or
                  acknowledged in text mode.
                </p>
              </section>
              <section className="drowned-panel">
                <h2>Interaction records</h2>
                <dl className="drowned-counts">
                  <div>
                    <dt>Play events (includes replays)</dt>
                    <dd>{stats.plays}</dd>
                  </div>
                  <div>
                    <dt>Emergency line changes</dt>
                    <dd>{stats.switches}</dd>
                  </div>
                  <div>
                    <dt>Available clips skipped</dt>
                    <dd>{stats.skippedClips}</dd>
                  </div>
                  <div>
                    <dt>Pending shots read as text</dt>
                    <dd>{stats.placeholders}</dd>
                  </div>
                </dl>
                <p className="drowned-small">
                  Text-mode actions do not count as video playback. Playback
                  events are client-reported, not proof of human viewing.
                </p>
              </section>
            </div>
            <section className="drowned-panel drowned-recent">
              <h2>Recent sessions</h2>
              {stats.recent.length === 0 ? (
                <div className="drowned-empty">
                  <p>No sessions yet.</p>
                  <a href="/drowned/">
                    Play the story to create the first record →
                  </a>
                </div>
              ) : (
                stats.recent.map((run) => (
                  <details key={run.session} className="drowned-run">
                    <summary>
                      <span>
                        {run.playerName ? <span data-no-translate>{run.playerName}</span> : 'Unnamed player'} · <code>{run.session}</code> ·{' '}
                        {run.ending ? run.ending + ' Ending' : run.scene}
                      </span>
                      <span>
                        {new Date(run.updatedAt).toLocaleString(locale)}
                      </span>
                    </summary>
                    <p className="drowned-small">
                      Emergency line:{' '}
                      {run.phone === 'idle'
                        ? 'Not answered'
                        : run.lineOpen
                          ? 'Open'
                          : 'Muted'}{' '}
                      · Latest {run.timeline.length} events
                    </p>
                    <ol className="drowned-timeline">
                      {run.timeline.map((event) => (
                        <li key={event.number}>
                          <time>
                            {new Date(event.at).toLocaleTimeString(locale)}
                          </time>
                          <span>
                            {event.type.replaceAll('_', ' ')}{' '}
                            <span className="drowned-muted">
                              ·{' '}
                              {event.label ??
                                event.ending ??
                                (typeof event.value === 'boolean'
                                  ? event.value
                                    ? 'Line open'
                                    : 'Line muted'
                                  : event.sceneId)}
                              {typeof event.position === 'number'
                                ? ' · ' + event.position.toFixed(1) + 's'
                                : ''}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))
              )}
            </section>
            <details className="drowned-panel drowned-production">
              <summary>
                Media production · {stats.media.available} clips available ·{' '}
                {stats.media.pending.length} shots pending
              </summary>
              <p className="drowned-small">
                Missing shots remain empty. No generation or credit use is
                triggered by this website. Voice-over and final sound mixing are
                also pending.
              </p>
              <ul>
                {stats.media.pending.map((shot) => (
                  <li key={shot.id}>
                    <strong>{shot.title}</strong>
                    <p>{shot.note}</p>
                  </li>
                ))}
              </ul>
            </details>
            <p className="drowned-note">
              Shared preview. AWS assessment deployment is tracked separately.
            </p>
          </>
        )}
      </main>
      <footer className="drowned-footer">
        <a href="/">← Story home</a>
      </footer>
    </div>
  );
}
