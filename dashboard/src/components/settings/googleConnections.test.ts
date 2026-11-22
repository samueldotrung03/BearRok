// Settings > Connections, rendered to HTML for each honest state. The live layer is stood in for,
// so no backend and no Google token is involved.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type GoogleInfo } from '../../lib/google/connection.ts';

const emptyGoogle = {
  server: null,
  connected: false,
  email: null,
  services: [] as GoogleInfo['services'],
  connectedAt: null,
  allCalendars: false,
  calendarSync: null,
};

const live = vi.hoisted(() => ({
  status: 'connected' as 'connecting' | 'connected' | 'offline',
  google: {
    server: null as GoogleInfo['server'],
    connected: false,
    email: null as string | null,
    services: [] as GoogleInfo['services'],
    connectedAt: null as string | null,
    allCalendars: false,
    calendarSync: null as GoogleInfo['calendarSync'],
  },
  sheet: null as { spreadsheetId: string; url: string; syncedAt: string; title?: string | null; tab?: string } | null,
  calendar: { connected: false, syncing: false, errors: [] as string[] },
  connectGoogle: vi.fn(async () => {}),
  disconnectGoogle: vi.fn(async () => ({ ok: true })),
  syncCalendar: vi.fn(async () => ({ ok: true })),
  syncSheet: vi.fn(async () => ({ ok: true })),
  linkSheet: vi.fn(async () => ({ ok: true })),
  unlinkSheet: vi.fn(async () => ({ ok: true })),
  refreshGoogle: vi.fn(async () => {}),
}));

vi.mock('../../state/live.tsx', () => ({ useLive: () => live }));

const server = { enabled: true, problem: null, needs: [] as string[], mayConnect: true };

async function html() {
  const { GoogleConnections } = await import('./GoogleConnections.tsx');
  return renderToString(createElement(GoogleConnections));
}

beforeEach(() => {
  live.status = 'connected';
  live.google = { ...emptyGoogle, server };
  live.sheet = null;
  live.calendar = { connected: false, syncing: false, errors: [] };
});

// Importing a page pulls in the app shell. Under a full parallel run the first import can take over a minute, past Vitest's five-second default.
describe('Google connection states', { timeout: 180_000 }, () => {
  it('says the server is not set up and names the env vars to set', async () => {
    live.google = { ...emptyGoogle, server: { enabled: false, problem: null, needs: ['GOOGLE_OAUTH_CLIENT_FILE', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'], mayConnect: false } };
    const page = await html();
    expect(page).toContain('Not set up on this server');
    expect(page).toContain('GOOGLE_OAUTH_CLIENT_FILE');
    expect(page).toContain('GOOGLE_OAUTH_CLIENT_ID');
    expect(page).toContain('GOOGLE_OAUTH_CLIENT_SECRET');
    expect(page).toContain('Desktop app');
    expect(page).not.toContain('Connect Google');
  });

  it('offers Connect when the account is not connected, and says to sign in when a guest cannot', async () => {
    expect(await html()).toContain('Connect Google');
    expect(await html()).toContain('Not connected');
    live.google = { ...emptyGoogle, server: { ...server, mayConnect: false } };
    const guest = await html();
    expect(guest).toContain('Sign in to connect');
    expect(guest).not.toContain('Connect Google');
  });

  it('shows the connected address, Calendar sync, and a linked sheet with its last write', async () => {
    live.google = {
      ...emptyGoogle,
      server,
      connected: true,
      email: 'ada@berkeley.edu',
      services: ['calendar', 'sheets'],
      connectedAt: new Date(Date.now() - 3_600_000).toISOString(),
      calendarSync: { at: new Date(Date.now() - 120_000).toISOString(), added: 2, removed: 0, errors: [] },
    };
    live.sheet = { spreadsheetId: 'sheet-1', url: 'https://docs.google.com/spreadsheets/d/sheet-1', syncedAt: new Date(Date.now() - 60_000).toISOString(), title: 'BearRok applications', tab: 'Applications' };
    const page = await html();
    expect(page).toContain('Connected as');
    expect(page).toContain('ada@berkeley.edu');
    expect(page).toContain('Disconnect');
    expect(page).toContain('Google Calendar');
    expect(page).toContain('Sync now');
    expect(page).toContain('2 added, 0 removed');
    expect(page).toContain('BearRok applications');
    expect(page).toContain('Last synced');
    expect(page).toContain('Use a sheet I already have');
    expect(page).not.toMatch(/ya29|refresh_token|access_token/);
  });

  it('offers to create a sheet, and says when Calendar was not allowed', async () => {
    live.google = { ...emptyGoogle, server, connected: true, email: 'ada@berkeley.edu', services: ['sheets'], connectedAt: new Date().toISOString() };
    const page = await html();
    expect(page).toContain('Create a sheet');
    expect(page).toContain('Not allowed');
    expect(page).toContain('Allow Calendar');
    expect(page).not.toContain('Sync now');
  });

  it('says the backend cannot be reached and offers to check again', async () => {
    live.status = 'offline';
    const page = await html();
    expect(page).toContain('Backend not reachable');
    expect(page).toContain('Check again');
  });
});
