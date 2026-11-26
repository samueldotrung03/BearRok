import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

// A stand-in for the real `grok` program: records its arguments and prints a canned reply.
// A `.mjs` file so Windows can run it; grokCli starts `.mjs` with Node instead of spawning a shell script.
const dir = mkdtempSync(join(tmpdir(), 'fake-grok-'));
const bin = join(dir, 'grok.mjs');
writeFileSync(
  bin,
  `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
writeFileSync(join(dir, 'args'), args.join('\\n') + '\\n');
let n = 0;
try { n = Number(readFileSync(join(dir, 'count'), 'utf8')) || 0; } catch { /* first call */ }
n += 1;
writeFileSync(join(dir, 'count'), String(n));
const numbered = join(dir, 'reply-' + n);
const body = existsSync(numbered) ? readFileSync(numbered) : existsSync(join(dir, 'reply')) ? readFileSync(join(dir, 'reply')) : '';
process.stdout.write(body);
if (existsSync(join(dir, 'stderr'))) process.stderr.write(readFileSync(join(dir, 'stderr')));
let code = 0;
try { code = Number(readFileSync(join(dir, 'exit'), 'utf8')) || 0; } catch { /* success */ }
process.exit(code);
`,
);
chmodSync(bin, 0o755);
process.env.GROK_TRANSPORT = 'cli';
process.env.GROK_CLI_BIN = bin;

const { grokJson } = await import('../src/grok.ts');
// Tests never read the saved harness choice, so the Grok harness is connected here by hand.
const { setHarnessStateForTest } = await import('../src/harness.ts');
setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
const { answerText, extractJson, structuredAnswer, fullestAnswer } = await import('../src/grokCli.ts');
const { readFileSync, rmSync } = await import('node:fs');
const Schema = z.object({ title: z.string(), url: z.string() });
const reset = () => { for (const f of ['count', 'reply-1', 'reply-2', 'exit', 'stderr']) rmSync(join(dir, f), { force: true }); };

test('CLI replies are unwrapped from the json envelope, prose and code fences', () => {
  assert.equal(answerText('{"result":"hello","session_id":"s1"}'), 'hello');
  assert.equal(answerText('{"message":{"content":"hi"}}'), 'hi');
  assert.equal(answerText('plain words'), 'plain words');
  assert.deepEqual(extractJson('Sure! ```json\n{"a":{"b":"}"}}\n``` done'), { a: { b: '}' } });
  assert.deepEqual(extractJson('Here it is: {"a":1} thanks'), { a: 1 });
  assert.throws(() => extractJson('no json here'));
});

test('grokJson goes through the Grok CLI when the Grok harness is connected', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), JSON.stringify({ result: '```json\n{"title":"Winter Hack","url":"https://example.org/w"}\n```' }));
  const { data } = await grokJson({ name: 't', system: 'You are a scout.', user: 'Find one.', schema: Schema, tools: [{ type: 'web_search' }], model: 'some-model' });
  assert.deepEqual(data, { title: 'Winter Hack', url: 'https://example.org/w' });
  const args = readFileSync(join(dir, 'args'), 'utf8');
  assert.match(args, /^-p\n/);
  assert.match(args, /You are a scout\./);
  assert.match(args, /"required":\["title","url"\]/);
  assert.match(args, /--output-format\njson/);
  // This CLI build rejects --no-auto-update. Leaving it in fails every live call.
  assert.doesNotMatch(args, /--no-auto-update/);
  assert.match(args, /-m\nsome-model/);
  // Tools are not auto-approved unless the setting is turned on.
  assert.doesNotMatch(args, /--always-approve/);
  // A headless call cannot ask, so page opens have to be allowed by name or the CLI cancels web_fetch.
  assert.match(args, /--allow\nWebSearch\n--allow\nWebFetch/);
  assert.match(args, /--json-schema\n/);
  assert.match(args, /--no-subagents/);
});

test('a reply that is not valid JSON is asked for once more', async () => {
  reset();
  writeFileSync(join(dir, 'reply-1'), 'Sorry, here you go:');
  writeFileSync(join(dir, 'reply-2'), '{"title":"A","url":"https://example.org/a"}');
  const { data } = await grokJson({ name: 't', system: 's', user: 'u', schema: Schema });
  assert.equal(data.title, 'A');
  assert.equal(readFileSync(join(dir, 'count'), 'utf8').trim(), '2');
});

test('a failing CLI gives a readable error', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), 'not logged in');
  writeFileSync(join(dir, 'exit'), '1');
  await assert.rejects(grokJson({ name: 't', system: 's', user: 'u', schema: Schema }), /grok exited 1: not logged in/);
});

test('the answer the CLI checked against the schema is used when it returns one', () => {
  assert.deepEqual(structuredAnswer('{"text":"{\\"a\\":1}","structuredOutput":{"a":1}}'), { a: 1 });
  assert.equal(structuredAnswer('{"text":"words only"}'), undefined);
  assert.equal(structuredAnswer('not json'), undefined);
});

test('an empty placeholder written before the real answer does not win', () => {
  const schema = z.object({ items: z.array(z.string()) });
  const out = JSON.stringify({ text: '{"items":[]}\n\n{"items":["a","b"]}', structuredOutput: { items: [] } });
  assert.deepEqual(fullestAnswer(out, schema), { items: ['a', 'b'] });
  assert.deepEqual(fullestAnswer(JSON.stringify({ text: 'done', structuredOutput: { items: ['x'] } }), schema), { items: ['x'] });
  assert.throws(() => fullestAnswer(JSON.stringify({ text: 'no answer here' }), schema));
  // A schema stub filled with the word "placeholder" can be longer than the real answer. The real one still wins.
  const fat = { items: ['placeholder', 'placeholder', 'placeholder', 'placeholder', 'placeholder'] };
  const real = { items: ['https://example.org/intern'] };
  assert.deepEqual(fullestAnswer(JSON.stringify({ text: JSON.stringify(real), structuredOutput: fat }), schema), real);
});

test('grok-4.3 is not sent to the CLI, and a failed exit that printed JSON is kept', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), '{"title":"Kept","url":"https://example.org/k"}');
  writeFileSync(join(dir, 'exit'), '1');
  const { data } = await grokJson({ name: 't', system: 's', user: 'u', schema: Schema, model: 'grok-4.3', tools: [{ type: 'web_search' }] });
  assert.equal(data.title, 'Kept');
  const args = readFileSync(join(dir, 'args'), 'utf8');
  assert.doesNotMatch(args, /grok-4\.3/);
  assert.match(args, /--allow\nWebFetch/);
});

test('a cancelled page read is the empty record the readers used to drop', async () => {
  const { readFileSync: read } = await import('node:fs');
  const raw = read(new URL('../fixtures/agent-cli/extractor-cancelled.json', import.meta.url), 'utf8');
  const schema = z.object({
    found: z.boolean(),
    record: z.object({ title: z.string(), sourceUrl: z.string() }).passthrough(),
  });
  const data = fullestAnswer(raw, schema);
  assert.equal(data.found, false);
  assert.equal(data.record.title, '');
  assert.equal(data.record.sourceUrl, '');
});

test('an exhausted Grok balance (HTTP 402) fails at once with a clear reason, and is not retried', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), '');
  writeFileSync(join(dir, 'stderr'), readFileSync(new URL('./fixtures/grok-402-stderr.txt', import.meta.url)));
  writeFileSync(join(dir, 'exit'), '1');
  const { BalanceExhaustedError, BALANCE_MESSAGE } = await import('../src/quota.ts');
  await assert.rejects(grokJson({ name: 't', system: 's', user: 'u', schema: Schema }), (e) => e instanceof BalanceExhaustedError && e.message === BALANCE_MESSAGE);
  assert.equal(readFileSync(join(dir, 'count'), 'utf8'), '1');
  reset();
});
