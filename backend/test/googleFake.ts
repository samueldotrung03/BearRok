// A student connected to Google with no network: the grant is set on the system, and Google's token
// endpoint is faked so the backend makes access token "tok" from it. Tests that need Google APIs
// pass `api` to answer them; anything else answers 404.
import type { AgentSystem } from '../src/agents/system.ts';

export const NOW_ISO = '2026-11-19T12:00:00.000Z';

export function connectGoogle(system: AgentSystem, services: ('calendar' | 'sheets')[] = ['calendar', 'sheets'], email = 'student@example.org') {
  system.setGoogle({ refreshToken: 'refresh-secret', services, connectedAt: NOW_ISO, email });
}

/** Options for createApp: an OAuth client and a fake Google. `api` answers every other Google call. */
export function fakeGoogle(api?: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'tok', expires_in: 3600 });
    if (u.startsWith('https://oauth2.googleapis.com/revoke')) return Response.json({});
    return api ? api(u, init) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { google: { client: { clientId: 'cid', clientSecret: 'secret' }, redirectBase: 'http://127.0.0.1:8798', fetch: fetchImpl }, calls };
}
