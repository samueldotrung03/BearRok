// Read-only routes for the Agents page's live view and history.
//   GET /api/students/:id/activity         { live, history }
//   GET /api/students/:id/activity/stream  SSE: "activity" (LiveActivity), "history" (RunReport[]), "ping"
// Opening them never starts a run and does not count as the app being open for Automode.
import type { Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AgentSystem } from '../agents/system.ts';
import type { ActivityHub } from './hub.ts';

export function mountActivity(app: Hono, hub: ActivityHub, systemOf: (c: Context) => Promise<AgentSystem>) {
  const base = '/api/students/:id/activity';

  app.get(base, async (c) => {
    const system = await systemOf(c);
    return c.json({ live: hub.live(system), history: hub.reports(system) });
  });

  app.get(`${base}/stream`, async (c) => {
    const system = await systemOf(c);
    return streamSSE(c, async (stream) => {
      const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
      await send('activity', hub.live(system));
      await send('history', hub.reports(system));
      const stop = hub.watch(system, (m) => void send(m.event, m.data));
      const beat = setInterval(() => void stream.writeSSE({ event: 'ping', data: '1' }).catch(() => {}), 15_000);
      beat.unref();
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(beat);
      stop();
    });
  });
}
