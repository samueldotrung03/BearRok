// The model harnesses (Claude, ChatGPT through Codex, Grok) on stand-in programs: no network, no
// real sign-in.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

// A stand-in for `codex exec`: records its arguments, what it read on stdin and whether an API key
// reached it, then writes a canned answer to the file named after -o.
const dir = mkdtempSync(join(tmpdir(), 'fake-codex-'));
const bin = join(dir, 'codex');
writeFileSync(
  bin,
  `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args"
cat > "${dir}/stdin"
echo "key=\${OPENAI_API_KEY:-none}" > "${dir}/env"
out=""
while [ $# -gt 0 ]; do if [ "$1" = "-o" ]; then out="$2"; fi; shift; done
cat "${dir}/reply" > "$out"
`,
);
chmodSync(bin, 0o755);
process.env.CODEX_CLI_BIN = bin;
process.env.OPENAI_API_KEY = 'sk-should-never-be-used';
// Claude and Grok are "not installed" here.
process.env.CLAUDE_CLI_BIN = join(dir, 'missing', 'claude');
process.env.GROK_CLI_BIN = join(dir, 'missing', 'grok');

const harness = await import('../src/harness.ts');
const { grokJson } = await import('../src/grok.ts');
const { strictSchema } = await import('../src/codexCli.ts');
const { createApp } = await import('../src/app.ts');
const { LocalStore } = await import('../src/store/local.ts');
const { AgentSystem } = await import('../src/agents/system.ts');
const { SimBrain } = await import('../src/agents/simBrain.ts');
const { GrokBrain } = await import('../src/agents/grokBrain.ts');

const Schema = z.object({ title: z.string(), url: z.string(), note: z.string().optional() });

test('harness: the apps are found where they are installed, and a missing one is not', () => {
  assert.equal(harness.findBin('codex'), bin);
  assert.equal(harness.findBin('claude'), null);
  assert.equal(harness.findBin('grok'), null);
});

test('harness: with nothing connected the agents are simulated and calls are refused', async () => {
  harness.setHarnessStateForTest({ connected: [], active: null });
  assert.equal(harness.liveAvailable(), false);
  assert.equal(harness.provider(), 'simulated');
  await assert.rejects(grokJson({ name: 't', system: 's', user: 'u', schema: Schema }), /No model is connected/);
});

test('harness: ChatGPT runs through codex exec, read-only, on the subscription and never an API key', async () => {
  harness.setHarnessStateForTest({ connected: ['codex'], active: 'codex' });
  assert.equal(harness.provider(), 'gpt');
  writeFileSync(join(dir, 'reply'), '{"title":"Winter Hack","url":"https://example.org/w"}');
  const { data } = await grokJson({ name: 't', system: 'You are a scout.', user: 'Find one.', schema: Schema, tools: [{ type: 'web_search' }] });
  assert.deepEqual(data, { title: 'Winter Hack', url: 'https://example.org/w' });
  const args = readFileSync(join(dir, 'args'), 'utf8').split('\n');
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.equal(args[args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-6.2-sol', 'the everyday model by default');
  assert.ok(args.includes('--output-schema'));
  assert.equal(args[args.indexOf('-c') + 1], 'web_search="live"', 'web search on for a search');
  assert.equal(args.at(-2), '-', 'the prompt is read from stdin');
  assert.match(readFileSync(join(dir, 'stdin'), 'utf8'), /You are a scout\.[\s\S]*Find one\./);
  assert.equal(readFileSync(join(dir, 'env'), 'utf8').trim(), 'key=none');

  await grokJson({ name: 't', system: 's', user: 'u', schema: Schema, model: 'gpt-6-luna' });
  const again = readFileSync(join(dir, 'args'), 'utf8').split('\n');
  assert.equal(again[again.indexOf('-m') + 1], 'gpt-6-luna');
  assert.ok(!again.includes('-c'), 'no web search when none is asked for');
  harness.setHarnessStateForTest({ connected: [], active: null });
});

test('harness: the schema given to Codex lists every property as required, as OpenAI asks', () => {
  const s = strictSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'object', properties: { c: { type: 'number' } } } }, required: ['a'] }) as any;
  assert.deepEqual(s.required, ['a', 'b']);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.b.required, ['c']);
});

test('harness: Settings connects a harness only after it answers, and can disconnect it', async () => {
  harness.setHarnessStateForTest({ connected: [], active: null });
  let fail: string | null = 'Not logged in. Run codex login.';
  const { app } = createApp(new LocalStore(null), {}, undefined, undefined, async () => {
    if (fail) throw new Error(fail);
  });
  const post = (path: string) => app.request(path, { method: 'POST' });

  const missing = await post('/api/harnesses/claude/connect');
  assert.equal(missing.status, 409);
  assert.match(((await missing.json()) as any).error, /not installed/);

  const signedOut = await post('/api/harnesses/codex/connect');
  assert.equal(signedOut.status, 409);
  assert.match(((await signedOut.json()) as any).error, /not signed in/);
  assert.equal(harness.activeHarness(), null);

  fail = null;
  const ok = (await (await post('/api/harnesses/codex/connect')).json()) as any;
  assert.equal(ok.active, 'codex');
  const codex = ok.harnesses.find((h: any) => h.id === 'codex');
  assert.equal(codex.connected, true);
  assert.equal(codex.installed, true);
  assert.equal(ok.harnesses.find((h: any) => h.id === 'grok').installed, false);
  assert.equal(harness.liveAvailable(), true);

  assert.equal((await app.request('/api/harnesses/active', { method: 'PUT', body: JSON.stringify({ id: 'grok' }) })).status, 409, 'Grok is not connected');
  assert.equal((await post('/api/harnesses/nope/connect')).status, 404);

  const off = (await (await post('/api/harnesses/codex/disconnect')).json()) as any;
  assert.equal(off.active, null);
  assert.equal(harness.liveAvailable(), false);
});

test('harness: a change moves the agents over without a restart', () => {
  const s = new AgentSystem(new SimBrain({ speed: 0 }), { feedTarget: 0 });
  assert.equal(s.student().provider, 'simulated');
  s.useEngine(new GrokBrain(), { provider: 'gpt' });
  assert.equal(s.student().provider, 'gpt');
  s.useEngine(new SimBrain({ speed: 0 }), {});
  assert.equal(s.student().provider, 'simulated');
});

test('harness: model names read as people know them', () => {
  assert.equal(harness.modelLabel('claude-opus-5-5'), 'Claude Opus 5.5');
  assert.equal(harness.modelLabel('gpt-6.2-sol'), 'GPT-6.2 Sol');
  assert.equal(harness.modelLabel('opus'), 'Claude Opus');
  assert.equal(harness.modelLabel(undefined), "the app's own default");
  assert.ok(!harness.HARNESSES.claude.models.some((m) => /fable/i.test(m.id)), 'no Fable');
});
