// Where the student's Google connection stands, worked out from what the backend says, kept apart
// from the pages so every state can be tested. The page never sees a Google token: it knows only
// whether the server is set up, who is connected, and which permissions Google gave.

export type GoogleService = 'calendar' | 'sheets';

/** What the backend says about Google for this student (GET /google). */
export interface GoogleServer {
  /** The server has an OAuth client. */
  enabled: boolean;
  /** Why it has none although one was meant to be set (a bad file, half the pair), or null. */
  problem: string | null;
  /** The env vars to set when it is not set up. */
  needs: string[];
  /** This student may connect: signed in, or the local user with sign-in off. */
  mayConnect: boolean;
}

/** The last write of deadlines to Google Calendar. */
export interface CalendarSync {
  at: string;
  added: number;
  removed: number;
  errors: string[];
}

/** The Google connection as the pages use it. */
export interface GoogleInfo {
  /** Null until the backend has answered. */
  server: GoogleServer | null;
  connected: boolean;
  email: string | null;
  services: GoogleService[];
  connectedAt: string | null;
  allCalendars: boolean;
  calendarSync: CalendarSync | null;
}

export const NO_GOOGLE: GoogleInfo = { server: null, connected: false, email: null, services: [], connectedAt: null, allCalendars: false, calendarSync: null };

/** The connection as the live stream carries it (no token, ever). */
export interface StreamGoogle {
  email: string | null;
  services: GoogleService[];
  connectedAt: string;
  allCalendars: boolean;
}

/** The stream's view of the connection over the server's answer: the stream is the fresher one. */
export function googleInfo(
  server: (GoogleServer & { connected?: boolean; connectedAt?: string | null; email?: string | null; services?: GoogleService[]; allCalendars?: boolean }) | null, stream: StreamGoogle | null | undefined, calendarSync: CalendarSync | null | undefined): GoogleInfo {
  const grant = stream !== undefined ? stream : server?.connected ? { email: server.email ?? null, services: server.services ?? [], connectedAt: server.connectedAt ?? '', allCalendars: server.allCalendars === true } : null;
  return {
    server: server ? { enabled: server.enabled, problem: server.problem, needs: server.needs, mayConnect: server.mayConnect } : null,
    connected: Boolean(grant),
    email: grant?.email ?? null,
    services: grant?.services ?? [],
    connectedAt: grant?.connectedAt || null,
    allCalendars: grant?.allCalendars === true,
    calendarSync: calendarSync ?? null,
  };
}

/**
 * The account row's state, in the order that matters:
 *   offline         the backend cannot be reached, so nothing can be said
 *   checking        waiting for the backend's first answer
 *   not_configured  the server has no Google OAuth client; Settings lists the env vars to set
 *   sign_in         sign-in is on and this is the shared guest, who cannot connect
 *   connecting      Google's consent screen is open; waiting for its answer
 *   error           the last attempt failed; the message says why and Connect tries again
 *   connected       a lasting connection is kept on the server
 *   not_connected   ready to connect
 */
export type AccountState = 'offline' | 'checking' | 'not_configured' | 'sign_in' | 'connecting' | 'error' | 'connected' | 'not_connected';

export function accountState(info: GoogleInfo, ui: { backend: 'connecting' | 'connected' | 'offline'; connecting: boolean; error: string | null }): AccountState {
  if (ui.backend === 'offline') return 'offline';
  if (!info.server) return 'checking';
  if (!info.server.enabled) return 'not_configured';
  if (ui.connecting) return 'connecting';
  if (ui.error) return 'error';
  if (info.connected) return 'connected';
  if (!info.server.mayConnect) return 'sign_in';
  return 'not_connected';
}

/**
 * One service's state under the account:
 *   off          the account is not connected (or the server is not set up)
 *   not_granted  the account is connected but Google's box for this service was left unticked
 *   ready        connected with this permission
 */
export type ServiceState = 'off' | 'not_granted' | 'ready';

export function serviceState(info: GoogleInfo, service: GoogleService): ServiceState {
  if (!info.server?.enabled || !info.connected) return 'off';
  return info.services.includes(service) ? 'ready' : 'not_granted';
}

/** What a failed Google request from the backend means for the page, in one line. */
export function googleError(status: number, body: { error?: string; reason?: string } | null): string {
  if (status === 0 || !body) return 'The backend cannot be reached. Start it, then try again.';
  return body.error ?? `Google said ${status}. Try again.`;
}
