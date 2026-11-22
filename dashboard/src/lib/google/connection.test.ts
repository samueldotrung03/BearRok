import { describe, expect, it } from 'vitest';
import { accountState, googleError, googleInfo, NO_GOOGLE, serviceState, type GoogleInfo, type GoogleServer } from './connection.ts';

const server: GoogleServer = { enabled: true, problem: null, needs: [], mayConnect: true };
const ready: GoogleInfo = { ...NO_GOOGLE, server };
const ui = { backend: 'connected' as const, connecting: false, error: null };

describe('accountState', () => {
  it('says offline before anything else, and checking until the server has answered', () => {
    expect(accountState(ready, { ...ui, backend: 'offline' })).toBe('offline');
    expect(accountState(NO_GOOGLE, { ...ui, backend: 'offline' })).toBe('offline');
    expect(accountState(NO_GOOGLE, ui)).toBe('checking');
  });

  it('says the server is not set up even while a connect is in progress or failed', () => {
    const info: GoogleInfo = { ...ready, server: { ...server, enabled: false, problem: 'the file cannot be read', needs: ['GOOGLE_OAUTH_CLIENT_FILE'] } };
    expect(accountState(info, { ...ui, connecting: true, error: 'nope' })).toBe('not_configured');
  });

  it('walks connecting, error, connected, sign-in, then ready to connect', () => {
    expect(accountState(ready, { ...ui, connecting: true })).toBe('connecting');
    expect(accountState({ ...ready, connected: true, email: 'ada@berkeley.edu' }, { ...ui, connecting: true })).toBe('connecting');
    expect(accountState(ready, { ...ui, error: 'Google did not connect. Try again.' })).toBe('error');
    expect(accountState({ ...ready, connected: true, email: 'ada@berkeley.edu' }, ui)).toBe('connected');
    expect(accountState({ ...ready, server: { ...server, mayConnect: false } }, ui)).toBe('sign_in');
    expect(accountState(ready, ui)).toBe('not_connected');
  });
});

describe('serviceState', () => {
  it('is off until this server is set up and the account is connected', () => {
    expect(serviceState(ready, 'sheets')).toBe('off');
    expect(serviceState({ ...ready, connected: true, server: { ...server, enabled: false } }, 'calendar')).toBe('off');
  });

  it('is ready when that permission was granted, and not granted when the box was left unticked', () => {
    const on: GoogleInfo = { ...ready, connected: true, services: ['calendar'] };
    expect(serviceState(on, 'calendar')).toBe('ready');
    expect(serviceState(on, 'sheets')).toBe('not_granted');
  });
});

describe('googleError', () => {
  it('says the backend cannot be reached, otherwise the reason the backend gave', () => {
    expect(googleError(0, null)).toBe('The backend cannot be reached. Start it, then try again.');
    expect(googleError(503, null)).toBe('The backend cannot be reached. Start it, then try again.');
    expect(googleError(403, { error: 'Sheets is not allowed.' })).toBe('Sheets is not allowed.');
    expect(googleError(500, {})).toBe('Google said 500. Try again.');
  });
});

describe('googleInfo', () => {
  it('uses the live stream when it has one, and never carries a token', () => {
    const info = googleInfo(
      { ...server, connected: true, email: 'old@x.test', services: ['calendar'], connectedAt: 't0', allCalendars: true },
      { email: 'ada@berkeley.edu', services: ['sheets'], connectedAt: 't1', allCalendars: false },
      { at: 't2', added: 2, removed: 1, errors: [] },
    );
    expect(info).toMatchObject({ connected: true, email: 'ada@berkeley.edu', services: ['sheets'], connectedAt: 't1', allCalendars: false });
    expect(info.calendarSync).toEqual({ at: 't2', added: 2, removed: 1, errors: [] });
    expect(info.server).toEqual(server);
    expect(info).not.toHaveProperty('refreshToken');
    expect(info).not.toHaveProperty('accessToken');
    expect(JSON.stringify(info)).not.toMatch(/ya29|refresh_token|access_token/);
  });

  it('a stream that says disconnected wins over an older server answer', () => {
    const info = googleInfo({ ...server, connected: true, email: 'ada@berkeley.edu', services: ['sheets'], connectedAt: 't0' }, null, null);
    expect(info.connected).toBe(false);
    expect(info.email).toBeNull();
  });
});
