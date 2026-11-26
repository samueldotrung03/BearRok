// The roadmap writer against a stand-in model. Nothing here calls a live model.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

process.env.XAI_API_KEY = 'test-key-not-live';
process.env.XAI_BASE_URL = 'https://api.x.ai/v1';

const { cached, RoadmapRequest, writeRoadmap } = await import('../src/roadmap.ts');
const { setHarnessStateForTest } = await import('../src/harness.ts');

const originalFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = originalFetch;
  setHarnessStateForTest({ connected: [], active: null });
});

type Body = {
  max_turns?: number;
  tools?: { type: string }[];
  text: { format: { name: string; schema: unknown } };
  input: { role: string; content: unknown }[];
};

const calls: Body[] = [];

/** Records each Responses body and returns the next scripted JSON. A status of 500 fails the call. */
function install(script: (body: Body, n: number) => { data: unknown; status?: number; citations?: string[] }) {
  calls.length = 0;
  globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body;
    calls.push(body);
    const next = script(body, calls.length);
    if (next.status && next.status >= 400) return new Response('down', { status: next.status });
    return new Response(JSON.stringify({ output_text: JSON.stringify(next.data), citations: next.citations ?? [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function userOf(body: Body): string {
  const user = body.input.find((item) => item.role === 'user');
  assert.equal(typeof user?.content, 'string');
  return user!.content as string;
}

function systemOf(body: Body): string {
  const system = body.input.find((item) => item.role === 'system');
  assert.equal(typeof system?.content, 'string');
  return system!.content as string;
}

const research = { notes: 'People built projects and then interned.', urls: ['https://example.com/path'] };

const step = (title: string, kind = 'learn') => ({
  title,
  detail: 'Do this once, for this student.',
  kind,
  actions: [] as string[],
  source: 'people',
  hours: 1,
  skills: ['Python'],
  strength: 'Most people did this',
  why: 'It is a common way in.',
  resources: [{ label: 'Guide', url: 'https://example.com/path' }],
});

const draft = (phases: number, each: number, summary: string, kind = 'learn') => ({
  summary,
  fit: { score: 40, met: ['Python'], missing: ['Systems'] },
  howPeopleGotIn: [{ outcome: 'Software engineer', timeline: ['Shipped a project'] }],
  phases: Array.from({ length: phases }, (_, i) => ({
    title: `Direction ${i + 1}`,
    window: '',
    more: [] as { title: string; why: string }[],
    steps: Array.from({ length: each }, (_, j) => step(`${summary} ${i + 1}.${j + 1}`, kind)),
  })),
});

const full = draft(5, 4, 'A full board');
const thin = draft(1, 1, 'A thin board');

const career = RoadmapRequest.parse({
  kind: 'career',
  goal: 'Software engineering',
  profile: { major: 'Computer Science', notes: ['No unpaid roles'] },
  knownPaths: [{ outcome: 'New grad', timeline: ['Shipped a project'] }],
});

const applied = RoadmapRequest.parse({
  kind: 'job',
  goal: 'Backend Intern at Cinder',
  profile: {},
  posting: { title: 'Backend Intern', organizer: 'Cinder', type: 'internship', status: 'applied' },
});

function answered(data: unknown, citations: string[] = []) {
  return { data, citations };
}

describe('writeRoadmap', { concurrency: false }, () => {
  test('searches once for how people get in, then fills the roadmap with no tools', async () => {
    install((body) => (body.text.format.name === 'roadmap_search' ? answered(research, ['https://example.com/cited']) : answered(full)));
    const result = await writeRoadmap(career);
    assert.equal(calls.length, 2);
    assert.equal(result.data.summary, 'A full board');
    assert.deepEqual(result.citations, ['https://example.com/cited', 'https://example.com/path']);

    const search = calls[0]!;
    assert.equal(search.text.format.name, 'roadmap_search');
    assert.deepEqual(search.tools, [{ type: 'web_search' }, { type: 'x_search' }]);
    assert.equal(search.max_turns, 2);
    assert.match(JSON.stringify(search.text.format.schema), /"notes"/);
    assert.match(JSON.stringify(search.text.format.schema), /"urls"/);
    const asked = `${systemOf(search)}\n${userOf(search)}`;
    assert.match(asked, /How do people get into this path, and which pages say so\?/);
    assert.match(userOf(search), /Software engineering/);
    assert.match(userOf(search), /New grad: Shipped a project/);
    assert.doesNotMatch(asked, /keep searching/i);

    const fill = calls[1]!;
    assert.equal(fill.text.format.name, 'roadmap');
    assert.equal(Object.hasOwn(fill, 'tools'), false);
    assert.equal(Object.hasOwn(fill, 'max_turns'), false);
    assert.match(JSON.stringify(fill.text.format.schema), /"phases"/);
    const filled = userOf(fill);
    assert.match(filled, /No unpaid roles/);
    assert.match(filled, /People built projects and then interned\./);
    assert.match(filled, /https:\/\/example\.com\/path/);
    assert.doesNotMatch(filled, /What is missing/);
    assert.equal(result.data.phases.length, 5);
  });

  test('a thin draft is filled again with no tools, passing the notes, the urls, and what is missing', async () => {
    let fills = 0;
    install((body) => {
      if (body.text.format.name === 'roadmap_search') return answered(research, ['https://example.com/cited']);
      fills += 1;
      return answered(fills === 1 ? thin : full);
    });
    const result = await writeRoadmap(career);
    assert.equal(calls.length, 3);
    assert.equal(result.data.summary, 'A full board');

    const retry = calls[2]!;
    assert.equal(retry.text.format.name, 'roadmap');
    assert.equal(Object.hasOwn(retry, 'tools'), false);
    assert.equal(Object.hasOwn(retry, 'max_turns'), false);
    assert.equal(JSON.stringify(retry).includes('web_search'), false);
    assert.equal(JSON.stringify(retry).includes('x_search'), false);
    const again = userOf(retry);
    assert.match(again, /People built projects and then interned\./);
    assert.match(again, /https:\/\/example\.com\/path/);
    assert.match(again, /What is missing: at least 5 phases \(this draft has 1\); at least 20 steps \(this draft has 1\)\./);

    fills = 0;
    install((body) => {
      if (body.text.format.name === 'roadmap_search') return answered(research);
      fills += 1;
      return answered(fills === 1 ? draft(1, 1, 'Still applying', 'apply') : draft(1, 3, 'While you wait', 'learn'));
    });
    const waiting = await writeRoadmap(applied);
    assert.equal(waiting.data.summary, 'While you wait');
    const appliedRetry = calls[2]!;
    assert.equal(Object.hasOwn(appliedRetry, 'tools'), false);
    assert.match(userOf(appliedRetry), /What is missing: no step with kind "apply"\./);
    assert.match(userOf(appliedRetry), /https:\/\/example\.com\/path/);
    assert.equal(JSON.stringify(appliedRetry).includes('web_search'), false);
  });

  test('a refill that fails, or is still thin, keeps the first draft and does not search again', async () => {
    let fills = 0;
    install((body) => {
      if (body.text.format.name === 'roadmap_search') return answered(research);
      fills += 1;
      return answered(thin);
    });
    // Second fill is also thin: the first draft stands, and only the first call searched.
    const stillThin = await writeRoadmap(career);
    assert.equal(stillThin.data.summary, 'A thin board');
    assert.equal(calls.filter((body) => body.text.format.name === 'roadmap_search').length, 1);
    assert.equal(calls.filter((body) => Object.hasOwn(body, 'tools')).length, 1);

    fills = 0;
    install((body) => {
      if (body.text.format.name === 'roadmap_search') return answered(research);
      fills += 1;
      return fills === 1 ? answered(thin) : { data: null, status: 500 };
    });
    const kept = await writeRoadmap(career);
    assert.equal(kept.data.summary, 'A thin board');
    assert.equal(calls.filter((body) => body.text.format.name === 'roadmap_search').length, 1);
    assert.equal(Object.hasOwn(calls[2]!, 'tools'), false);
  });

  test('cached stores one finished answer per distinct request', async () => {
    let fail = false;
    install((body) => {
      if (fail) return { data: null, status: 500 };
      return answered(body.text.format.name === 'roadmap_search' ? research : full);
    });
    const writer = cached(writeRoadmap);
    const goal = (name: string) => RoadmapRequest.parse({ kind: 'career', goal: name, profile: {} });
    const first = await writer(goal('Software engineering'));
    const again = await writer(goal('Software engineering'));
    assert.equal(again, first);
    assert.equal(calls.length, 2, 'the same request is not written twice');
    await writer(goal('Design'));
    assert.equal(calls.length, 4);

    fail = true;
    const broken = cached(writeRoadmap);
    await assert.rejects(() => broken(goal('Nursing')), /Grok 500/);
    const afterFail = calls.length;
    fail = false;
    const recovered = await broken(goal('Nursing'));
    assert.equal(recovered.data.summary, 'A full board');
    assert.ok(calls.length > afterFail, 'a failed call is not remembered');
  });

  test('the Grok CLI search stops after two turns, and a thin refill does not turn web search back on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'roadmap-grok-'));
    const bin = join(dir, 'grok.mjs');
    writeFileSync(
      bin,
      `import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
let n = 0;
try { n = Number(readFileSync(join(dir, 'count'), 'utf8')) || 0; } catch { /* first call */ }
n += 1;
writeFileSync(join(dir, 'count'), String(n));
writeFileSync(join(dir, 'call-' + n + '.json'), JSON.stringify(args));
process.stdout.write(readFileSync(join(dir, 'reply-' + n)));
`,
    );
    chmodSync(bin, 0o755);
    writeFileSync(join(dir, 'reply-1'), JSON.stringify(research));
    writeFileSync(join(dir, 'reply-2'), JSON.stringify(thin));
    writeFileSync(join(dir, 'reply-3'), JSON.stringify(full));
    process.env.GROK_CLI_BIN = bin;
    setHarnessStateForTest({ connected: ['grok'], active: 'grok' });
    try {
      const result = await writeRoadmap(career);
      assert.equal(result.data.summary, 'A full board');
      assert.deepEqual(result.citations, ['https://example.com/path']);
      assert.equal(readFileSync(join(dir, 'count'), 'utf8').trim(), '3');

      const args = (n: number) => JSON.parse(readFileSync(join(dir, `call-${n}.json`), 'utf8')) as string[];
      const search = args(1);
      const prompt = search[search.indexOf('-p') + 1] ?? '';
      assert.match(prompt, /How do people get into this path, and which pages say so\?/);
      assert.doesNotMatch(prompt, /keep searching/i);
      assert.equal(search[search.indexOf('--max-turns') + 1], '2');
      assert.ok(search.includes('--allow') && search.includes('WebSearch'));
      assert.equal(search.includes('--disable-web-search'), false);

      for (const n of [2, 3]) {
        const fill = args(n);
        assert.equal(fill.includes('--max-turns'), false);
        assert.ok(fill.includes('--disable-web-search'));
        assert.equal(fill.includes('--allow'), false);
        assert.equal(fill.includes('web_search'), false);
        assert.equal(fill.includes('x_search'), false);
        const text = fill[fill.indexOf('-p') + 1] ?? '';
        assert.match(text, /People built projects and then interned\./);
        assert.match(text, /https:\/\/example\.com\/path/);
      }
      const retry = args(3)[args(3).indexOf('-p') + 1] ?? '';
      assert.match(retry, /What is missing: at least 5 phases \(this draft has 1\); at least 20 steps \(this draft has 1\)\./);
    } finally {
      setHarnessStateForTest({ connected: [], active: null });
      delete process.env.GROK_CLI_BIN;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
