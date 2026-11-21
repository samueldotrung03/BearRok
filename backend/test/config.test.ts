import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { config, provider, resolveGrokTransport } from '../src/config.ts';
import { LocalStore } from '../src/store/local.ts';

test('GROK_TRANSPORT accepts cli and api, and warns on anything else', () => {
  const warnings: string[] = [];
  const orig = console.warn;
  console.warn = (message?: unknown) => {
    warnings.push(String(message));
  };
  try {
    assert.equal(resolveGrokTransport(undefined), 'api');
    assert.equal(resolveGrokTransport(''), 'api');
    assert.equal(resolveGrokTransport('api'), 'api');
    assert.equal(resolveGrokTransport('cli'), 'cli');
    assert.equal(resolveGrokTransport('CLI'), 'cli');
    assert.equal(warnings.length, 0);
    assert.equal(resolveGrokTransport('claude'), 'api');
    assert.equal(resolveGrokTransport('gpt'), 'api');
    assert.equal(warnings.length, 2);
    assert.match(warnings[0]!, /claude/);
    assert.match(warnings[0]!, /GROK_TRANSPORT=cli/);
  } finally {
    console.warn = orig;
  }
});

test('the loaded transport matches the resolver, and health reports it', async () => {
  assert.equal(config.grokTransport, resolveGrokTransport(process.env.GROK_TRANSPORT));
  const { app } = createApp(new LocalStore(null));
  const body = (await (await app.request('/api/health')).json()) as { ok: boolean; provider: string; transport: string; live: boolean };
  assert.equal(body.ok, true);
  assert.equal(body.transport, config.grokTransport);
  assert.equal(body.provider, provider());
  assert.equal(body.live, provider() === 'grok');
});
