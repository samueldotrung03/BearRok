// Career discovery, offline, section by section: fixture Grok answers (test/fixtures/careers), and
// the ways a live run goes wrong: a timeout, an answer that cannot be read, an empty balance (402),
// and a restart in the middle. Also one guide per career name, the merge of duplicates, a part
// saved the moment it is checked, searching one part again, and the simulated agents end to end.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Hono } from 'hono';
import { mountCareers } from '../src/careers/api.ts';
import { CareerGuides, careerKey, type Ask, type Guide } from '../src/careers/guide.ts';
import { simulatedAsk, parseFaults } from '../src/careers/simulated.ts';
import { BalanceExhaustedError } from '../src/quota.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/careers/data-engineering.json', import.meta.url), 'utf8')) as Record<string, unknown>;

type Reply = (n: number, user: string) => unknown;

/**
 * A model that answers from the fixture. `script` replaces an answer for a call name; it may return
 * an Error to throw, a promise to wait on, or undefined for the fixture. Validators echo the part.
 */
function scriptedAsk(calls: string[], script: Record<string, Reply> = {}): Ask {
  return (async (opts) => {
    calls.push(opts.name);
    const n = calls.filter((c) => c === opts.name).length;
    await new Promise((r) => setTimeout(r, 1));
    let given = await script[opts.name]?.(n, opts.user);
    if (given instanceof Error) throw given;
    if (given === undefined) given = opts.name.startsWith('career_review_') ? { data: JSON.parse(opts.user.split('WROTE IT:\n')[1]!), removed: [] } : fixture[opts.name];
    return { data: opts.schema.parse(given) };
  }) as Ask;
}

const grok = { live: () => true, provider: () => 'grok' as const, canSearchX: () => true };
const simulated = { live: () => false, provider: () => 'simulated' as const, canSearchX: () => true };
const quick = { timeoutMs: 20, graceMs: 0 };
const hang = () => new Promise(() => {});
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'career-flow-')), 'career-guides.json');
const onDisk = (file: string, slug: string) => (JSON.parse(readFileSync(file, 'utf8')) as { guides: Guide[] }).guides.find((g) => g.slug === slug);
const count = (calls: string[], name: string) => calls.filter((c) => c === name).length;

function gate() {
  let open!: () => void;
  const shut = new Promise<void>((r) => (open = r));
  return { shut, open };
}

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 2));
  }
}

// ---- names ------------------------------------------------------------------------------------

test('names of the same career share one key; different careers do not', () => {
  const same = ['AI Engineering', 'AI Engineer', 'ai engineering', 'an AI engineer', 'AI engineers', '  AI   Engineering  ', 'AI engineering career'];
  for (const name of same) assert.equal(careerKey(name), 'ai-engineer', name);
  assert.equal(careerKey('Machine Learning Engineering'), careerKey('ML Engineer'));
  assert.equal(careerKey('Data Science'), careerKey('data scientist'));
  assert.equal(careerKey('Nursing'), careerKey('Nurse'));
  assert.notEqual(careerKey('Data Engineering'), careerKey('Data Science'));
  assert.notEqual(careerKey('AI Engineering'), careerKey('Machine Learning Engineering'));
  assert.notEqual(careerKey('Software Engineer'), careerKey('Software Developer'));
  assert.equal(careerKey('!!'), '');
});

test('any name of a career opens its one guide, and the name is kept as an alias', async () => {
  const calls: string[] = [];
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_plan: () => ({ ...(fixture.career_plan as object), title: 'AI Engineer' }) }), grok);
  guides.start('AI Engineering');
  await guides.settled('ai-engineering');
  for (const name of ['AI Engineer', 'ai engineering', 'AI engineers']) assert.equal(guides.start(name).slug, 'ai-engineering', name);
  assert.equal(guides.list().length, 1);
  assert.equal(count(calls, 'career_plan'), 1, 'no second guide was researched');
  assert.deepEqual(guides.get('ai-engineering')!.aliases, ['AI engineers']);
  assert.equal(guides.view('ai-engineer', null)!.slug, 'ai-engineering');
});

test('a guide whose plan names a career that already has a guide becomes another name for it', async () => {
  const calls: string[] = [];
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_plan: () => ({ ...(fixture.career_plan as object), title: 'AI Engineer' }) }), grok);
  guides.start('AI Engineering');
  await guides.settled('ai-engineering');
  guides.start('Artificial intelligence engineering');
  await guides.settled('artificial-intelligence-engineering');
  assert.equal(guides.get('artificial-intelligence-engineering'), null, 'no stray guide is kept');
  assert.equal(guides.list().length, 1);
  assert.equal(guides.find('Artificial intelligence engineering')!.slug, 'ai-engineering');
  assert.equal(count(calls, 'career_basics'), 1, 'the folded guide researched no parts');
});

test('guides kept under two names of one career are merged on load, without repeats', () => {
  const file = tempFile();
  const base = (slug: string, query: string, startedAt: string, extraPost?: string): Guide => ({
    slug,
    query,
    title: 'AI Engineer',
    oneLine: 'Builds products on top of AI models.',
    field: 'ai',
    angles: null,
    status: 'ready',
    provider: 'grok',
    startedAt,
    updatedAt: startedAt,
    error: null,
    failure: null,
    aliases: [],
    sections: {
      basics: { status: 'done', data: fixture.career_basics, sample: false, error: null, added: null } as never,
      voices: { status: 'done', data: { summary: 'S.', posts: [{ author: 'A', role: 'r', handle: null, text: 'Same post', takeaway: 't', topic: 'the work', url: 'https://x.com/a/1', date: null }, ...(extraPost ? [{ author: 'B', role: 'r', handle: null, text: extraPost, takeaway: 't', topic: 'advice', url: 'https://x.com/b/2', date: null }] : [])] }, sample: false, error: null, added: null } as never,
      interview: { status: 'done', data: fixture.career_interview, sample: false, error: null, added: null } as never,
      start: slug === 'ai-engineer' ? ({ status: 'done', data: fixture.career_start, sample: false, error: null, added: null } as never) : ({ status: 'failed', data: null, sample: false, error: 'x', added: null } as never),
    },
    asks: [],
    activity: [],
  });
  const other = { ...base('machine-learning-engineering', 'Machine Learning Engineering', '2026-11-20T10:00:00Z'), title: 'Machine Learning Engineer' };
  writeFileSync(file, JSON.stringify({ guides: [base('ai-engineering', 'AI Engineering', '2026-11-20T09:00:00Z'), other, base('ai-engineer', 'AI Engineer', '2026-11-20T11:00:00Z', 'A new post')] }));

  const guides = new CareerGuides(file, scriptedAsk([]), grok);
  assert.deepEqual(guides.list().map((g) => g.slug).sort(), ['ai-engineering', 'machine-learning-engineering']);
  const kept = guides.get('ai-engineering')!;
  assert.equal(kept.sections.voices.data!.posts.length, 2, 'the duplicate post is kept once, the new one is added');
  assert.equal(kept.sections.start.status, 'done', 'a part only the duplicate had is taken over');
  assert.ok(kept.aliases.includes('ai-engineer'));
  assert.equal(guides.find('ai-engineer')!.slug, 'ai-engineering');
  // The merge is written back, so the next start sees one guide.
  assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as { guides: Guide[] }).guides.map((g) => g.slug).sort(), ['ai-engineering', 'machine-learning-engineering']);
});

// ---- saved as it goes, and restarts --------------------------------------------------------------

test('each part is on disk the moment it is checked, and the researcher answer before its check', async () => {
  const file = tempFile();
  const voicesCheck = gate();
  const interview = gate();
  const guides = new CareerGuides(
    file,
    scriptedAsk([], {
      career_review_voices: async () => {
        await voicesCheck.shut;
        return undefined;
      },
      career_interview: async () => {
        await interview.shut;
        return undefined;
      },
    }),
    grok,
  );
  guides.start('Data Engineering');
  await until(() => onDisk(file, 'data-engineering')?.sections.basics.status === 'done' && onDisk(file, 'data-engineering')?.sections.voices.stage === 'validating');
  const saved = onDisk(file, 'data-engineering')!;
  assert.equal(saved.sections.basics.data!.skills[0]!.name, 'SQL');
  assert.equal(saved.sections.voices.status, 'working');
  assert.equal(saved.sections.voices.draft!.posts.length, 3, "the researcher's posts are saved before the check");
  assert.equal(saved.sections.interview.stage, 'researching');
  assert.equal(guides.view('data-engineering', null)!.sections.voices.draft, null, 'drafts are not sent to the page');
  voicesCheck.open();
  interview.open();
  assert.equal((await guides.settled('data-engineering'))!.status, 'ready');
  assert.equal(onDisk(file, 'data-engineering')!.sections.voices.draft, null);
});

test('a restart keeps finished parts, picks up a checked-off answer from its check, and runs the rest again', async () => {
  const file = tempFile();
  const first: string[] = [];
  const before = new CareerGuides(file, scriptedAsk(first, { career_review_voices: hang, career_interview: hang }), grok);
  before.start('Data Engineering');
  await until(() => onDisk(file, 'data-engineering')?.sections.basics.status === 'done' && onDisk(file, 'data-engineering')?.sections.voices.stage === 'validating');

  // The backend restarts: a new instance reads the same file.
  const calls: string[] = [];
  const after = new CareerGuides(file, scriptedAsk(calls), grok);
  const marked = after.get('data-engineering')!;
  assert.equal(marked.status, 'ready', 'the finished basics make it a partial guide, not a failed one');
  assert.equal(marked.sections.basics.status, 'done');
  assert.equal(marked.sections.voices.failure, 'interrupted');
  assert.match(marked.sections.voices.error!, /answer is saved/);
  assert.equal(marked.sections.interview.failure, 'interrupted');

  assert.deepEqual(after.resume(), ['data-engineering']);
  const done = (await after.settled('data-engineering'))!;
  for (const id of ['basics', 'voices', 'interview', 'start'] as const) assert.equal(done.sections[id].status, 'done', id);
  assert.equal(count(calls, 'career_basics'), 0, 'finished work is not redone');
  assert.equal(count(calls, 'career_voices'), 0, 'the saved posts go straight to their check');
  assert.equal(count(calls, 'career_review_voices'), 1);
  assert.equal(count(calls, 'career_interview'), 1);
  assert.ok(calls.indexOf('career_start') > calls.indexOf('career_review_interview'), 'how to start still waits for the interviews');
  assert.equal(done.sections.voices.data!.posts.length, 3);
});

test('a restart during the plan plans again on resume', async () => {
  const file = tempFile();
  new CareerGuides(file, scriptedAsk([], { career_plan: hang }), grok).start('Data Engineering');
  const calls: string[] = [];
  const after = new CareerGuides(file, scriptedAsk(calls), grok);
  assert.equal(after.get('data-engineering')!.status, 'failed');
  assert.equal(after.get('data-engineering')!.failure, 'interrupted');
  after.resume();
  const g = (await after.settled('data-engineering'))!;
  assert.equal(g.status, 'ready');
  assert.equal(g.failure, null);
  assert.equal(g.title, 'Data Engineer');
});

test("a restart onto other agents leaves the parts marked: simulated agents never finish Grok's guide", async () => {
  const file = tempFile();
  new CareerGuides(file, scriptedAsk([], { career_interview: hang }), grok).start('Data Engineering');
  await until(() => onDisk(file, 'data-engineering')?.sections.basics.status === 'done');
  const after = new CareerGuides(file, scriptedAsk([]), simulated);
  assert.deepEqual(after.resume(), []);
  const g = after.get('data-engineering')!;
  assert.equal(g.sections.interview.failure, 'interrupted');
  assert.throws(() => after.retry('data-engineering', 'interview'), /Grok researched this guide/);
  assert.throws(() => after.start('Data Engineering', true), /Grok researched this guide/);
  assert.equal(after.start('Data Engineering').sections.basics.status, 'done', 'opening it shows what Grok found');
});

test('an unreadable guides file is set aside, never written over', () => {
  const file = tempFile();
  writeFileSync(file, '{"guides": [ half a file');
  const guides = new CareerGuides(file, scriptedAsk([]), grok);
  assert.equal(guides.list().length, 0);
  assert.equal(readFileSync(file, 'utf8'), '{"guides": [ half a file');
  assert.ok(readdirSync(join(file, '..')).some((f) => f.includes('.unreadable-')));
});

// ---- failures, one part at a time ----------------------------------------------------------------

test('a researcher that times out is tried once more, then its part fails with the reason; the rest finish', async () => {
  const calls: string[] = [];
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_basics: hang }), grok, quick);
  guides.start('Data Engineering');
  const g = (await guides.settled('data-engineering'))!;
  assert.equal(count(calls, 'career_basics'), 2, 'one retry');
  assert.equal(g.sections.basics.status, 'failed');
  assert.equal(g.sections.basics.failure, 'timeout');
  assert.match(g.sections.basics.error!, /researcher timed out twice/);
  assert.equal(g.status, 'ready', 'a partial guide');
  for (const id of ['voices', 'interview', 'start'] as const) assert.equal(g.sections[id].status, 'done');
});

test('the CLI time limit is what each call is given', async () => {
  const seen: (number | undefined)[] = [];
  const ask = (async (opts: Parameters<Ask>[0]) => {
    seen.push(opts.timeoutMs);
    return scriptedAsk([])(opts);
  }) as Ask;
  const guides = new CareerGuides(null, ask, grok, { timeoutMs: 1234 });
  guides.start('Data Engineering');
  await guides.settled('data-engineering');
  assert.ok(seen.length > 0 && seen.every((t) => t === 1234));
});

test('a validator that times out twice keeps the researcher answer, marked unchecked', async () => {
  const guides = new CareerGuides(null, scriptedAsk([], { career_review_interview: hang }), grok, quick);
  guides.start('Data Engineering');
  const g = (await guides.settled('data-engineering'))!;
  assert.equal(g.sections.interview.status, 'done');
  assert.match(g.sections.interview.unchecked!, /Not checked: the validator timed out twice/);
  assert.equal(g.sections.interview.data!.formats.length, 3);
});

test('an answer that cannot be read is tried once more, then the part says so; how to start still runs', async () => {
  const calls: string[] = [];
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_interview: () => ({ formats: 'not a list' }) }), grok);
  guides.start('Data Engineering');
  const g = (await guides.settled('data-engineering'))!;
  assert.equal(count(calls, 'career_interview'), 2);
  assert.equal(g.sections.interview.failure, 'parse');
  assert.match(g.sections.interview.error!, /could not be read/);
  assert.equal(g.sections.start.status, 'done', 'how to start is written with no formats to prepare for');
});

test('an empty Grok balance (402) stops the run at once and says so; finished parts are kept', async () => {
  const calls: string[] = [];
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_interview: () => new BalanceExhaustedError() }), grok);
  guides.start('Data Engineering');
  const g = (await guides.settled('data-engineering'))!;
  assert.equal(count(calls, 'career_interview'), 1, 'no retry on an empty balance');
  assert.equal(count(calls, 'career_start'), 0, 'nothing is started after it');
  assert.equal(g.failure, 'balance');
  assert.match(g.error!, /usage balance exhausted/);
  assert.equal(g.sections.interview.failure, 'balance');
  assert.equal(g.sections.start.failure, 'balance');
  assert.equal(g.sections.basics.status, 'done');
});

test('a 402 while planning fails the guide with the balance reason; an old raw CLI 402 error is read the same way', async () => {
  const guides = new CareerGuides(null, scriptedAsk([], { career_plan: () => new BalanceExhaustedError() }), grok);
  guides.start('Data Engineering');
  const g = (await guides.settled('data-engineering'))!;
  assert.equal(g.status, 'failed');
  assert.equal(g.failure, 'balance');

  const file = tempFile();
  const old = { ...g, failure: undefined, aliases: undefined, error: 'Could not plan the guide: grok CLI exited 1: Error: Internal error: {"message": "API error (status 402 Payment Required): Grok Build usage balance exhausted"}' };
  writeFileSync(file, JSON.stringify({ guides: [old] }));
  const loaded = new CareerGuides(file, scriptedAsk([]), grok).get('data-engineering')!;
  assert.equal(loaded.failure, 'balance');
  assert.equal(loaded.error, 'Could not plan the guide: Grok usage balance exhausted; top up to continue.');
});

// ---- one part again ---------------------------------------------------------------------------------

test('Search again on one part reruns only that part', async () => {
  const calls: string[] = [];
  let broken = true;
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_basics: () => (broken ? hang() : undefined) }), grok, quick);
  guides.start('Data Engineering');
  const before = (await guides.settled('data-engineering'))!;
  assert.equal(before.sections.basics.failure, 'timeout');
  const others = JSON.stringify([before.sections.voices, before.sections.interview, before.sections.start]);
  broken = false;
  calls.length = 0;

  const g = guides.retry('data-engineering', 'basics');
  assert.equal(g.sections.basics.status, 'working');
  assert.throws(() => guides.retry('data-engineering', 'basics'), /already working on this part/);
  const after = (await guides.settled('data-engineering'))!;
  assert.deepEqual(calls, ['career_basics', 'career_review_basics']);
  assert.equal(after.sections.basics.status, 'done');
  assert.equal(after.sections.basics.failure, null);
  assert.equal(JSON.stringify([after.sections.voices, after.sections.interview, after.sections.start]), others, 'the other parts are untouched');
});

test('Search again on a part whose check hit the empty balance starts from the saved answer', async () => {
  const calls: string[] = [];
  let empty = true;
  const guides = new CareerGuides(null, scriptedAsk(calls, { career_review_start: () => (empty ? new BalanceExhaustedError() : undefined) }), grok);
  guides.start('Data Engineering');
  const before = (await guides.settled('data-engineering'))!;
  assert.equal(before.sections.start.failure, 'balance');
  assert.equal(before.failure, 'balance');
  empty = false;
  calls.length = 0;
  guides.retry('data-engineering', 'start');
  const after = (await guides.settled('data-engineering'))!;
  assert.deepEqual(calls, ['career_review_start']);
  assert.equal(after.sections.start.status, 'done');
  assert.equal(after.failure, null, 'a part that went through clears the balance notice');
});

test('a part cannot be searched again while it waits its turn in the first search', async () => {
  const interview = gate();
  const guides = new CareerGuides(null, scriptedAsk([], { career_interview: async () => void (await interview.shut) }), grok);
  guides.start('Data Engineering');
  await until(() => guides.get('data-engineering')!.status === 'researching');
  assert.throws(() => guides.retry('data-engineering', 'start'), /next in the search/);
  assert.throws(() => guides.retry('data-engineering', 'salary'), /no such part/);
  assert.throws(() => guides.retry('nobody', 'basics'), /No guide/);
  interview.open();
  await guides.settled('data-engineering');
});

// ---- the simulated agents ---------------------------------------------------------------------------

test('the simulated agents run the whole flow offline: research, Add more, suggestions, and one part again', async () => {
  const guides = new CareerGuides(null, simulatedAsk({ stepMs: 0, faults: '' }), simulated);
  guides.start('Marine Biology');
  const g = (await guides.settled('marine-biology'))!;
  assert.equal(g.status, 'ready');
  assert.equal(g.provider, 'simulated');
  for (const id of ['basics', 'voices', 'interview', 'start'] as const) {
    assert.equal(g.sections[id].status, 'done', id);
    assert.equal(g.sections[id].sample, true, `${id} is labelled a sample`);
  }
  assert.ok(g.sections.voices.data!.summary);
  assert.ok(g.sections.start.data!.steps.some((s) => s.prepares.length), 'steps prepare for the interview formats');
  assert.equal((await guides.suggest('marine-biology', 'basics')).length, 3);
  guides.more('marine-biology', 'basics', { prompt: 'more', by: 'u1' });
  assert.equal((await guides.settled('marine-biology'))!.asks[0]!.status, 'done');
  guides.retry('marine-biology', 'voices');
  assert.equal((await guides.settled('marine-biology'))!.sections.voices.status, 'done');
});

test('simulated faults show each failed state offline, and a retry then goes through', async () => {
  assert.deepEqual([...parseFaults('interview:timeout, basics:402:1, start:parse:3, x:nope')], [
    ['interview', { fault: 'timeout', left: 2 }],
    ['basics', { fault: '402', left: 1 }],
    ['start', { fault: 'parse', left: 3 }],
  ]);
  const guides = new CareerGuides(null, simulatedAsk({ stepMs: 0, faults: 'interview:timeout' }), simulated);
  guides.start('Marine Biology');
  const g = (await guides.settled('marine-biology'))!;
  assert.equal(g.sections.interview.failure, 'timeout');
  assert.equal(g.sections.start.status, 'done');
  guides.retry('marine-biology', 'interview');
  assert.equal((await guides.settled('marine-biology'))!.sections.interview.status, 'done');
});

test('a simulated guide is researched again by Grok once Grok is connected', async () => {
  const file = tempFile();
  const sim = new CareerGuides(file, simulatedAsk({ stepMs: 0, faults: '' }), simulated);
  sim.start('Data Engineering');
  await sim.settled('data-engineering');
  const calls: string[] = [];
  const live = new CareerGuides(file, scriptedAsk(calls), grok);
  const g = live.start('Data Engineering');
  assert.equal(g.status, 'planning');
  const done = (await live.settled('data-engineering'))!;
  assert.equal(done.provider, 'grok');
  assert.equal(done.sections.basics.sample, false);
  assert.equal(done.sections.basics.data!.skills[0]!.name, 'SQL');
});

// ---- routes --------------------------------------------------------------------------------------

test('routes: start, open by any name, search one part again, and say plainly when it is refused', async () => {
  const app = new Hono();
  let broken = true;
  const guides = new CareerGuides(null, scriptedAsk([], { career_voices: () => (broken ? new Error('the reply contained no JSON object') : undefined) }), grok);
  mountCareers(app, guides);
  const json = { 'content-type': 'application/json' };
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', body: JSON.stringify(body), headers: json });

  const started = await post('/api/careers/guides', { career: 'Data Engineering', by: 'u1' });
  assert.equal(started.status, 202);
  await guides.settled('data-engineering');
  const byTitle = (await (await app.request('/api/careers/guides/data-engineer')).json()) as { guide: Guide };
  assert.equal(byTitle.guide.slug, 'data-engineering');
  assert.equal(byTitle.guide.sections.voices.failure, 'parse');

  broken = false;
  const retried = await post('/api/careers/guides/data-engineering/sections/voices/retry', { by: 'u1' });
  assert.equal(retried.status, 202);
  assert.equal(((await retried.json()) as { guide: Guide }).guide.sections.voices.status, 'working');
  assert.equal((await post('/api/careers/guides/data-engineering/sections/voices/retry', {})).status, 409);
  await guides.settled('data-engineering');
  const after = (await (await app.request('/api/careers/guides/Data%20Engineer')).json()) as { guide: Guide };
  assert.equal(after.guide.sections.voices.status, 'done');

  assert.equal((await post('/api/careers/guides/data-engineering/sections/salary/retry', {})).status, 404);
  assert.equal((await post('/api/careers/guides/nobody/sections/basics/retry', {})).status, 404);
  const list = (await (await app.request('/api/careers/guides')).json()) as { guides: { slug: string; aliases: string[] }[] };
  assert.deepEqual(list.guides.map((g) => g.slug), ['data-engineering']);
  assert.ok(!existsSync('career-guides.json'));
});

test('routes: simulated agents may not touch a Grok guide, and the page is told why', async () => {
  const file = tempFile();
  const live = new CareerGuides(file, scriptedAsk([]), grok);
  live.start('Data Engineering');
  await live.settled('data-engineering');
  const app = new Hono();
  mountCareers(app, new CareerGuides(file, scriptedAsk([]), simulated));
  const res = await app.request('/api/careers/guides/data-engineering/sections/basics/retry', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /simulated examples never replace what Grok found/);
  const refresh = await app.request('/api/careers/guides', { method: 'POST', body: JSON.stringify({ career: 'data engineer', refresh: true }), headers: { 'content-type': 'application/json' } });
  assert.equal(refresh.status, 503);
});
