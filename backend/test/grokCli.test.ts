import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

// A stand-in for the real `grok` program: records its arguments and prints a canned reply.
// A `.mjs` file so Windows can run it: CreateProcess returns ENOENT on an extensionless #!/bin/sh
// file, and a `.cmd` shim would split quoted argv. harness.ts starts `.mjs` with Node.
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
const { config } = await import('../src/config.ts');
// Tests never read the saved harness choice, so the Grok harness is connected here by hand.
const { setHarnessStateForTest } = await import('../src/harness.ts');
setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
const { answerText, extractJson, structuredAnswer, fullestAnswer } = await import('../src/grokCli.ts');
const { GrokBrain, DEADLINE_RULE, DEADLINE_FINDER_SEARCH } = await import('../src/agents/grokBrain.ts');
const { readFileSync, rmSync } = await import('node:fs');
const Schema = z.object({ title: z.string(), url: z.string() });
const reset = () => { for (const f of ['count', 'reply-1', 'reply-2', 'exit', 'stderr']) rmSync(join(dir, f), { force: true }); };

test('the default Grok CLI config leaves alwaysApprove false when GROK_CLI_ALWAYS_APPROVE is unset', () => {
  assert.ok(
    process.env.GROK_CLI_ALWAYS_APPROVE === undefined || process.env.GROK_CLI_ALWAYS_APPROVE === '',
    'GROK_CLI_ALWAYS_APPROVE must stay unset so the default stays locked',
  );
  assert.equal(config.grokCli.alwaysApprove, false);
});

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

const assignment = { managerId: 'm1', name: 'Manager 1', category: 'internship' as const, lens: 'field' as const, focus: ['software'], budget: 8, others: [] };
const brief = { goal: 'internships', hardCriteria: [], preferences: [], avoid: [], interests: ['coding'], year: 'Freshman' as const, location: 'Berkeley, CA', remoteOk: true, notes: [] };
const spec = { label: 'software internships', query: 'software internship freshman open Berkeley remote', lensValue: 'software', maxLeads: 4 };
const promptArgs = () => readFileSync(join(dir, 'args'), 'utf8');

test('API and simulated scouts still ask for up to 4 leads', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), JSON.stringify({ leads: [{ title: 'A', url: 'https://example.org/a' }] }));
  await new GrokBrain().scout(spec, assignment, brief, new Set());
  const args = promptArgs();
  assert.match(args, /Search the web and return up to 4 leads/);
  assert.doesNotMatch(args, /Do not open the posting pages/);
  assert.doesNotMatch(args, /at most two title-and-URL pairs/);
});

test('a live CLI scout runs one query, returns at most two pairs, and does not open posting pages', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), JSON.stringify({
    leads: [
      { title: 'A', url: 'https://example.org/a' },
      { title: 'B', url: 'https://example.org/b' },
      { title: 'C', url: 'https://example.org/c' },
    ],
  }));
  const leads = await new GrokBrain({ scoutMaxLeads: 2 }).scout(spec, assignment, brief, new Set());
  assert.equal(leads.length, 2);
  assert.deepEqual(leads.map((l) => l.title), ['A', 'B']);
  const args = promptArgs();
  assert.match(args, /Run the manager's Search query once and return at most two title-and-URL pairs/);
  assert.match(args, /Do not open the posting pages/);
  assert.match(args, /Stop after that one search even if fewer than two leads come back/);
  assert.doesNotMatch(args, /Search the web and return up to 4 leads/);
  // The CLI wrapper still tells extractors they may open pages.
  assert.match(args, /Use web search and open the pages/);
});

test('the manager query names the kind, class year, an apply word, and place or remote, and skips LinkedIn and Handshake', async () => {
  reset();
  writeFileSync(join(dir, 'reply'), JSON.stringify({ jobs: [{ label: 'software', query: 'software internship freshman open Berkeley remote', lensValue: 'software' }] }));
  await new GrokBrain().planJobs(assignment, brief, []);
  const args = promptArgs();
  assert.match(args, /at most 3 search jobs/);
  assert.match(args, /kind of opportunity/);
  assert.match(args, /class year/);
  assert.match(args, /open, deadline, apply, or register/);
  assert.match(args, /place or the word remote/);
  assert.match(args, /Do not name LinkedIn or Handshake/);
});

test('extractors and the status reviewer do not search other listings for a deadline', () => {
  assert.match(DEADLINE_RULE, /Read only the pages you were given/);
  assert.match(DEADLINE_RULE, /If those pages state no deadline, return null/);
  assert.match(DEADLINE_RULE, /Do not search other listings/);
  assert.doesNotMatch(DEADLINE_RULE, /search for other public postings of the same opportunity/);
  assert.match(DEADLINE_RULE, /current cycle/);
  assert.match(DEADLINE_RULE, /"Rolling"/);
  assert.match(DEADLINE_RULE, /deadlineSource/);
});

test('the deadline finder runs three queries and then stops', async () => {
  assert.equal(DEADLINE_FINDER_SEARCH, 'Run exactly three searches: the title plus "deadline", the title plus "apply by", and the title plus the year. Then stop.');
  reset();
  writeFileSync(join(dir, 'reply'), JSON.stringify({ found: false, deadline: null, url: null, quote: null }));
  await new GrokBrain().findDeadline({
    type: 'internship', title: 'Summer Intern', organizer: 'Org', sourceUrl: 'https://example.org/intern', actionUrl: null,
    format: 'online', location: null, field: 'software', tags: [], eligibility: null, eligibleYears: null,
    deadline: null, deadlineSource: null, startTime: null, image: null, evidence: [],
  });
  const args = promptArgs();
  assert.match(args, /Run exactly three searches: the title plus "deadline", the title plus "apply by", and the title plus the year\. Then stop\./);
  assert.doesNotMatch(args, /Run several searches with different wording/);
  assert.doesNotMatch(args, /Do not search other listings/);
});

test('the CLI engine in server.ts sets a feed of 8 and a scout cap of 2', () => {
  const src = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.match(src, /feedTarget:\s*8/);
  assert.match(src, /new GrokBrain\(\{\s*scoutMaxLeads:\s*2\s*\}\)/);
  assert.match(src, /scoutMaxLeads:\s*2/);
  assert.equal(config.feed.target, 12);
});
