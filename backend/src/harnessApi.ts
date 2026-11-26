// Connecting the model harnesses from Settings: Claude, ChatGPT (Codex) and Grok, each through its
// app for the command line on this computer. Nothing secret is sent or returned: the apps keep their
// own sign-ins. Only these three apps can be run, found in the usual install folders; a request
// cannot name a program or a prompt.
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  activeHarness,
  connectedHarnesses,
  disconnect,
  findBin,
  HARNESS_IDS,
  HARNESSES,
  isHarnessId,
  markConnected,
  modelLabel,
  setActive,
  type HarnessId,
} from './harness.ts';

export type Checker = (id: HarnessId) => Promise<void>;

const Ok = z.object({ ok: z.boolean() });

/** One tiny prompt on the harness's everyday model, to prove the app is signed in and answers. */
export const tryHarness: Checker = async (id) => {
  const ask = { name: 'connect_check', system: 'You check that a connection works.', user: 'Reply with {"ok": true}.', schema: Ok, model: HARNESSES[id].defaults.low, timeoutMs: 150_000 };
  const answer =
    id === 'claude'
      ? await (await import('./claudeCli.ts')).claudeCliJson(ask)
      : id === 'codex'
        ? await (await import('./codexCli.ts')).codexCliJson(ask)
        : await (await import('./grokCli.ts')).grokCliJson(ask);
  if (!answer.data.ok) throw new Error('the app answered, but not as expected');
};

/** Why a check failed, in words a student can act on. */
function reason(id: HarnessId, message: string): string {
  const h = HARNESSES[id];
  if (/not found/i.test(message)) return `${h.cli} is not installed on this computer.`;
  if (/log ?in|sign ?in|auth|unauthori[sz]ed|credential|401|403|not logged/i.test(message)) return `${h.cli} is installed but not signed in. Sign in with your ${h.name} account, then connect again.`;
  if (/timed out/i.test(message)) return `${h.cli} did not answer in time. Check your internet connection and try again.`;
  return `${h.cli} could not answer: ${message.slice(0, 240)}`;
}

export function harnessStatus() {
  const connected = connectedHarnesses();
  return {
    active: activeHarness(),
    harnesses: HARNESS_IDS.map((id) => {
      const h = HARNESSES[id];
      return {
        id,
        name: h.name,
        cli: h.cli,
        installed: findBin(id) !== null,
        connected: connected.includes(id),
        active: activeHarness() === id,
        install: h.install,
        login: h.login,
        loginHint: h.loginHint,
        models: h.models,
        defaults: { normal: modelLabel(h.defaults.normal), low: modelLabel(h.defaults.low) },
      };
    }),
  };
}

export function mountHarnesses(app: Hono, check: Checker = tryHarness) {
  const checking = new Map<HarnessId, Promise<void>>();

  app.get('/api/harnesses', (c) => c.json(harnessStatus()));

  app.post('/api/harnesses/:id/connect', async (c) => {
    const id = c.req.param('id');
    if (!isHarnessId(id)) return c.json({ error: 'unknown harness' }, 404);
    if (!findBin(id)) return c.json({ ...harnessStatus(), error: reason(id, 'not found') }, 409);
    // Two clicks share one check.
    let run = checking.get(id);
    if (!run) {
      run = check(id).finally(() => checking.delete(id));
      checking.set(id, run);
    }
    try {
      await run;
    } catch (e) {
      return c.json({ ...harnessStatus(), error: reason(id, e instanceof Error ? e.message : String(e)) }, 409);
    }
    markConnected(id);
    return c.json(harnessStatus());
  });

  app.post('/api/harnesses/:id/disconnect', (c) => {
    const id = c.req.param('id');
    if (!isHarnessId(id)) return c.json({ error: 'unknown harness' }, 404);
    disconnect(id);
    return c.json(harnessStatus());
  });

  // Which connected harness the agents run on.
  app.put('/api/harnesses/active', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!isHarnessId(body?.id) || !setActive(body.id)) return c.json({ ...harnessStatus(), error: 'connect that model first' }, 409);
    return c.json(harnessStatus());
  });
}
