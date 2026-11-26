import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { liveAvailable, provider } from '../src/config.ts';
import { transport } from '../src/harness.ts';
import { LocalStore } from '../src/store/local.ts';

test('health reports the harness transport, not a startup-only Grok setting', async () => {
  const { app } = createApp(new LocalStore(null));
  const body = (await (await app.request('/api/health')).json()) as { ok: boolean; provider: string; transport: string | null; live: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.transport, transport());
  assert.equal(body.provider, provider());
  assert.equal(body.live, liveAvailable());
});
