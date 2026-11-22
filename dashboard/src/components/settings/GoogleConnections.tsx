// Settings > Connections: the student's Google account, and the two things BearRok does with it,
// Google Calendar (deadlines put on it by themselves) and Google Sheets (applications written to a
// sheet in their Drive). Every state is said plainly: the server not set up (with the env vars to
// set), not connected, waiting for Google, connected as whom, and an error with a way to try again.
// No Google token ever reaches this page: the backend keeps the connection and makes every call.
import { ArrowSquareOut, CalendarBlank, GoogleLogo, Table } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { authMessage } from '../../auth/errors.ts';
import { isDesktop } from '../../auth/desktop.ts';
import { accountState, serviceState, type AccountState } from '../../lib/google/connection.ts';
import { relativeTime } from '../../lib/time.ts';
import { useLive, type GoogleResult } from '../../state/live.tsx';
import { ActionButton, Note, Row, Status } from '../settingsParts.tsx';

/** A failed Connect in words: the backend's own reason when it gave one, else the sign-in wording. */
function connectMessage(e: unknown): string | null {
  const code = (e as { code?: string })?.code;
  if (code === 'google/not-started' || code === 'google/not-configured') return (e as Error).message;
  const text = authMessage(e);
  return text === 'Sign-in did not work. Try again.' ? 'Google did not connect. Try again.' : text;
}

const accountStatus: Record<AccountState, { tone: 'on' | 'off' | 'wait' | 'warn'; text: string }> = {
  offline: { tone: 'warn', text: 'Backend not reachable' },
  checking: { tone: 'wait', text: 'Checking' },
  not_configured: { tone: 'off', text: 'Not set up on this server' },
  sign_in: { tone: 'off', text: 'Sign in to connect' },
  connecting: { tone: 'wait', text: 'Waiting for Google' },
  error: { tone: 'warn', text: 'Did not connect' },
  connected: { tone: 'on', text: 'Connected' },
  not_connected: { tone: 'off', text: 'Not connected' },
};

const Code = ({ children }: { children: string }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[13px]">{children}</code>;

/** One action's outcome under its row: a short success line, or the error with Try again. */
function Outcome({ result, onRetry, okText }: { result: GoogleResult | null; onRetry: () => void; okText: string }) {
  if (!result) return null;
  if (result.ok) return <Note kind="ok">{okText}</Note>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-0 flex-1 basis-56">
        <Note kind="error">{result.error ?? 'That did not work.'}</Note>
      </div>
      <ActionButton onClick={onRetry}>Try again</ActionButton>
    </div>
  );
}

export function GoogleConnections() {
  const live = useLive();
  const g = live.google;

  // ---- the account ----------------------------------------------------------------------
  // Like sign-in, Connect is never locked: clicking again starts over, so a closed tab never sticks.
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<AbortController | null>(null);
  useEffect(() => () => attempt.current?.abort(), []);
  const connect = async (switchAccount = false) => {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setConnecting(true);
    setError(null);
    try {
      await live.connectGoogle(controller.signal, { switchAccount });
    } catch (e) {
      if (attempt.current === controller) setError(connectMessage(e));
    } finally {
      if (attempt.current === controller) {
        attempt.current = null;
        setConnecting(false);
      }
    }
  };
  const cancel = () => {
    attempt.current?.abort();
    attempt.current = null;
    setConnecting(false);
  };
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnect = async () => {
    setDisconnecting(true);
    const out = await live.disconnectGoogle();
    setDisconnecting(false);
    setError(out.ok ? null : (out.error ?? 'Google could not be disconnected. Try again.'));
  };
  const state = accountState(g, { backend: live.status, connecting, error });
  const pill = accountStatus[state];

  // ---- Calendar -------------------------------------------------------------------------
  const calendar = serviceState(g, 'calendar');
  const [calendarResult, setCalendarResult] = useState<GoogleResult | null>(null);
  const syncCalendar = async () => {
    setCalendarResult(null);
    setCalendarResult(await live.syncCalendar());
  };
  const lastSync = g.calendarSync;

  // ---- Sheets ---------------------------------------------------------------------------
  const sheets = serviceState(g, 'sheets');
  const sheet = live.sheet;
  const [sheetBusy, setSheetBusy] = useState<'sync' | 'create' | 'link' | 'unlink' | null>(null);
  const [sheetResult, setSheetResult] = useState<{ result: GoogleResult; okText: string; retry: () => void } | null>(null);
  const [picking, setPicking] = useState(false);
  const [address, setAddress] = useState('');
  const runSheet = async (kind: 'sync' | 'create' | 'link' | 'unlink', okText: string) => {
    setSheetBusy(kind);
    setSheetResult(null);
    const result =
      kind === 'sync' ? await live.syncSheet() : kind === 'create' ? await live.syncSheet({ create: true }) : kind === 'link' ? await live.linkSheet(address) : await live.unlinkSheet();
    setSheetBusy(null);
    setSheetResult({ result, okText, retry: () => void runSheet(kind, okText) });
    if (result.ok && kind === 'link') {
      setPicking(false);
      setAddress('');
    }
  };

  const ready = state === 'connected';

  return (
    <>
      <Row
        icon={<GoogleLogo weight="bold" />}
        title="Google account"
        text="One connection for Google Calendar and Google Sheets below. BearRok keeps it on its server and never shows it to this page."
        status={<Status tone={pill.tone}>{pill.text}</Status>}
        action={
          state === 'connected' ? (
            <>
              <ActionButton onClick={() => void connect(true)}>Use another account</ActionButton>
              <ActionButton disabled={disconnecting} onClick={() => void disconnect()}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </ActionButton>
            </>
          ) : state === 'not_connected' || state === 'connecting' || state === 'error' ? (
            <ActionButton primary onClick={() => void connect()}>
              {state === 'connecting' ? 'Connect again' : state === 'error' ? 'Try again' : 'Connect Google'}
            </ActionButton>
          ) : state === 'offline' ? (
            <ActionButton onClick={() => void live.refreshGoogle()}>Check again</ActionButton>
          ) : null
        }
      >
        <div className="space-y-2" aria-live="polite">
          {state === 'connected' && (
            <p className="text-sm text-ink-2">
              Connected as <span className="font-semibold text-ink">{g.email ?? 'a Google account (its address was not shared)'}</span>
              {g.connectedAt ? `, since ${relativeTime(g.connectedAt)}` : ''}. It stays connected until you disconnect.
            </p>
          )}
          {state === 'connecting' && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 basis-56 text-sm text-ink-2">
                {isDesktop ? 'Finish in your browser, then come back here.' : 'Finish in the Google tab that opened.'} Tick both permissions on Google's screen. Closed it? Press Connect again.
              </p>
              <ActionButton onClick={cancel}>Cancel</ActionButton>
            </div>
          )}
          {state === 'error' && error && <Note kind="error">{error}</Note>}
          {state === 'offline' && <p className="text-sm text-ink-2">Start the agent backend, then check again.</p>}
          {state === 'sign_in' && <p className="text-sm text-ink-2">Sign in to BearRok first; each account connects its own Google.</p>}
          {state === 'not_configured' && (
            <div className="space-y-2 text-sm text-ink-2">
              {g.server?.problem && <Note kind="error">{g.server.problem}</Note>}
              <p>This BearRok server has no Google OAuth client yet, so nothing Google can be connected. To set one up:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>In Google Cloud, create an OAuth client of type Desktop app, and turn on the Google Calendar API and Google Sheets API.</li>
                <li>
                  In the backend settings (<Code>backend/.env</Code>), set <Code>GOOGLE_OAUTH_CLIENT_FILE</Code> to the downloaded JSON file, or set{' '}
                  <Code>GOOGLE_OAUTH_CLIENT_ID</Code> and <Code>GOOGLE_OAUTH_CLIENT_SECRET</Code>.
                </li>
                <li>Restart the backend and come back here.</li>
              </ol>
            </div>
          )}
        </div>
      </Row>

      <Row
        icon={<CalendarBlank />}
        title="Google Calendar"
        text="Puts every To apply and Applying deadline on your calendar, with reminders a week before, two days before and on the day, and keeps them in step."
        status={
          calendar === 'ready' ? (
            live.calendar.syncing ? (
              <Status tone="wait">Syncing</Status>
            ) : lastSync?.errors.length ? (
              <Status tone="warn">Some not added</Status>
            ) : (
              <Status tone="on">On</Status>
            )
          ) : calendar === 'not_granted' ? (
            <Status tone="warn">Not allowed</Status>
          ) : (
            <Status tone="off">Off</Status>
          )
        }
        action={
          calendar === 'ready' ? (
            <ActionButton disabled={live.calendar.syncing} onClick={() => void syncCalendar()}>
              {live.calendar.syncing ? 'Syncing…' : 'Sync now'}
            </ActionButton>
          ) : calendar === 'not_granted' ? (
            <ActionButton onClick={() => void connect()}>Allow Calendar</ActionButton>
          ) : null
        }
      >
        <div className="space-y-2" aria-live="polite">
          {calendar === 'off' && <p className="text-sm text-ink-2">{ready ? '' : 'Connect your Google account above to turn this on.'}</p>}
          {calendar === 'not_granted' && <p className="text-sm text-ink-2">The Calendar box was left unticked on Google's screen. Press Allow Calendar and tick it.</p>}
          {calendar === 'ready' && (
            <p className="text-[13px] text-ink-3">
              {lastSync
                ? `Last synced ${relativeTime(lastSync.at)}: ${lastSync.added} added, ${lastSync.removed} removed.`
                : 'Not synced yet. It syncs by itself when a deadline or status changes.'}
            </p>
          )}
          {calendar === 'ready' && lastSync && lastSync.errors.length > 0 && !calendarResult && (
            <Outcome result={{ ok: false, error: `Google refused: ${lastSync.errors.slice(0, 3).join('; ')}` }} onRetry={() => void syncCalendar()} okText="" />
          )}
          <Outcome
            result={calendarResult}
            onRetry={() => void syncCalendar()}
            okText={calendarResult?.ok && lastSync?.errors.length ? 'Synced, with some refused (see above).' : 'Your calendar is up to date.'}
          />
        </div>
      </Row>

      <Row
        icon={<Table />}
        title="Google Sheets"
        text="Writes your applications, from Saved to Applied, to a sheet in your Drive: stage, deadline, links, materials and questions. It rewrites itself when anything changes."
        status={
          sheets === 'ready' ? (
            sheet ? (
              <Status tone="on">Linked</Status>
            ) : (
              <Status tone="off">No sheet yet</Status>
            )
          ) : sheets === 'not_granted' ? (
            <Status tone="warn">Not allowed</Status>
          ) : (
            <Status tone="off">Off</Status>
          )
        }
        action={
          sheets === 'ready' ? (
            sheet ? (
              <ActionButton disabled={sheetBusy !== null} onClick={() => void runSheet('sync', 'Your sheet is up to date.')}>
                {sheetBusy === 'sync' ? 'Writing…' : 'Sync now'}
              </ActionButton>
            ) : (
              <ActionButton primary disabled={sheetBusy !== null} onClick={() => void runSheet('create', 'A new sheet is made in your Drive.')}>
                {sheetBusy === 'create' ? 'Creating…' : 'Create a sheet'}
              </ActionButton>
            )
          ) : sheets === 'not_granted' ? (
            <ActionButton onClick={() => void connect()}>Allow Sheets</ActionButton>
          ) : null
        }
      >
        <div className="space-y-3" aria-live="polite">
          {sheets === 'off' && !ready && <p className="text-sm text-ink-2">Connect your Google account above to turn this on.</p>}
          {sheets === 'not_granted' && <p className="text-sm text-ink-2">The Sheets box was left unticked on Google's screen. Press Allow Sheets and tick it.</p>}
          {sheet && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <a href={sheet.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                {sheet.title || 'Your Google Sheet'} <ArrowSquareOut className="size-3.5" aria-hidden="true" />
              </a>
              <span className="text-[13px] text-ink-3">
                {sheet.tab ? `Tab “${sheet.tab}”. ` : ''}
                {sheet.syncedAt ? `Last synced ${relativeTime(sheet.syncedAt)}.` : 'Not written yet.'}
                {sheets !== 'ready' ? ' Not updating until Google is connected with Sheets.' : ''}
              </span>
            </div>
          )}
          {sheets === 'ready' && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {!picking && (
                <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setPicking(true)}>
                  Use a sheet I already have
                </button>
              )}
              {sheet && (
                <button type="button" className="font-semibold text-brand hover:underline disabled:opacity-60" disabled={sheetBusy !== null} onClick={() => void runSheet('create', 'A new sheet is made in your Drive and linked.')}>
                  {sheetBusy === 'create' ? 'Creating…' : 'Create a new sheet instead'}
                </button>
              )}
              {sheet && (
                <button
                  type="button"
                  className="font-semibold text-ink-3 hover:text-ink disabled:opacity-60"
                  disabled={sheetBusy !== null}
                  title="Stop writing to this sheet. The file stays in your Drive."
                  onClick={() => void runSheet('unlink', 'Unlinked. The sheet stays in your Drive.')}
                >
                  Unlink
                </button>
              )}
            </div>
          )}
          {sheets === 'ready' && picking && (
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void runSheet('link', 'Linked and written. BearRok added an “Applications” tab and left your other tabs alone.');
              }}
            >
              <input
                type="url"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Paste the sheet's address (docs.google.com/spreadsheets/d/…)"
                aria-label="Address of your Google Sheet"
                autoComplete="off"
                className="h-10 min-w-0 flex-1 basis-64 rounded-xl border border-line bg-white px-3 text-sm outline-none focus:border-brand focus:ring-3 focus:ring-brand/15"
              />
              <ActionButton type="submit" disabled={sheetBusy !== null || address.trim().length < 20}>
                {sheetBusy === 'link' ? 'Linking…' : 'Link this sheet'}
              </ActionButton>
              <button type="button" className="text-sm font-semibold text-ink-3 hover:text-ink" onClick={() => setPicking(false)}>
                Cancel
              </button>
            </form>
          )}
          {sheetResult && <Outcome result={sheetResult.result} onRetry={sheetResult.retry} okText={sheetResult.okText} />}
        </div>
      </Row>
    </>
  );
}
