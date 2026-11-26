import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import type { StudentState } from '../src/agents/system.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Opportunity } from '../src/agents/types.ts';
import { createApp } from '../src/app.ts';
import { grokJson } from '../src/grok.ts';
import { cachedSearch, lookupSystem, mergeAnswer, ownMatches, searchContext, searchPrompt, searchSystem, setSearchModelForTest, writeSearch, SearchRequest, type SearchWriter } from '../src/search.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = Date.parse('2026-11-19T12:00:00Z');
const posting = (id: string, title: string, organizer: string, deadline: string | null, type: Opportunity['type'] = 'internship') =>
  ({ id, title, organizer, type, deadline, tags: [], field: 'Software', location: 'Berkeley, CA', eligibility: null, fitExplanation: `${title} fits`, sourceUrl: `https://example.org/${id}`, actionUrl: null }) as unknown as Opportunity;
const entry = (o: Opportunity) => ({ opportunity: o }) as StudentState['feed'][number];

const student = {
  feed: [entry(posting('a', 'Software engineering intern', 'Stripe', '2026-11-24')), entry(posting('b', 'Data science intern', 'Lyft', '2027-02-01')), entry(posting('c', 'Fall career fair', 'Cal', null, 'event'))],
  savedItems: [entry(posting('b', 'Data science intern', 'Lyft', '2027-02-01'))],
  applications: [{ opportunityId: 'a', status: 'applying' }],
} as unknown as StudentState;

test('search: the student\'s own postings that match the query, applications and saved first', () => {
  const req = (query: string, extra = {}) => SearchRequest.parse({ query, ...extra });
  const found = ownMatches(student, req('intern'), NOW);
  assert.deepEqual(found.map((r) => [r.opportunityId, r.origin]), [['a', 'application'], ['b', 'saved']]);
  assert.equal(found[0]!.status, 'applying');
  assert.deepEqual(found.map((r) => r.id), ['L1', 'L2']);
  // A posting must match at least half of the query's words.
  assert.deepEqual(ownMatches(student, req('stripe engineering intern'), NOW).map((r) => r.opportunityId), ['a']);
  assert.deepEqual(ownMatches(student, req('stripe marketing design'), NOW), []);
  // Filters: kind, and a deadline window (no deadline only fits "any time").
  assert.deepEqual(ownMatches(student, req('intern', { time: 'week' }), NOW).map((r) => r.opportunityId), ['a']);
  assert.deepEqual(ownMatches(student, req('career fair', { kind: 'event' }), NOW).map((r) => r.opportunityId), ['c']);
  assert.deepEqual(ownMatches(student, req('career fair', { time: 'open' }), NOW), []);
});

test('search: notes lead the context, personal off sends none, and the answer keeps only real results', () => {
  const profile = { name: 'A', school: 'UC Berkeley', year: 'Freshman', major: 'EECS', location: 'Berkeley', remoteOk: true, interests: ['AI'], skills: ['Python'], categories: [], careerInterests: [], eventTypes: [],
    preferences: { fields: [], topField: null, answers: {}, lists: { skipCompanies: ['Acme'] }, checks: { paidOnly: true, remote: false }, notes: [{ title: 'Only paid', body: 'Nothing unpaid' }], experience: { linkedin: '', links: [], entries: [] } } } as any;
  const ctx = searchContext(profile, 'Built a compiler');
  assert.match(ctx.text, /^NOTES FROM THE STUDENT[^\n]*\n- Only paid: Nothing unpaid/);
  assert.match(ctx.text, /"skipCompanies":\["Acme"\]/);
  assert.match(ctx.text, /"checks":\["paidOnly"\]/);
  assert.deepEqual(ctx.parts, ['your notes', 'your profile', 'your restrictions', 'your résumé']);
  const req = SearchRequest.parse({ query: 'stripe intern', personal: false });
  assert.match(searchPrompt(req, ctx.text, [], 't'), /personal context is turned off/);
  assert.doesNotMatch(searchPrompt(req, ctx.text, [], 't'), /Only paid/);

  const own = ownMatches(student, SearchRequest.parse({ query: 'intern' }), NOW);
  const r = (x: object) => ({ ref: '', title: 'T', organizer: '', type: 'internship' as const, url: '', source: '', snippet: '', deadline: '', location: '', why: 'fits', score: 80, ...x });
  const merged = mergeAnswer({ intent: 'i', answer: 'Best is [3], then [1]; [2] and [4] were dropped, and [6].', related: ['x'], contextUsed: [], results: [
    r({ ref: 'L1', score: 90 }),
    r({ ref: 'L2', score: 30 }), // weak own match: left out
    r({ url: 'https://jobs.example.com/1', deadline: '2026-12-01', score: 85 }),
    r({ url: 'not a link' }), // no real link: left out
    r({ url: 'https://jobs.example.com/1' }), // repeat: left out
    r({ url: 'https://other.example.com/2', deadline: 'soon' }),
  ] }, own);
  assert.deepEqual(merged.results.map((x) => [x.origin, x.opportunityId ?? x.url, x.score]), [['application', 'a', 90], ['web', 'https://jobs.example.com/1', 85], ['web', 'https://other.example.com/2', 80]]);
  assert.equal(merged.results[1]!.deadline, '2026-12-01');
  // Citations follow the results to their new places; ones to dropped results go.
  assert.equal(merged.answer, 'Best is [2], then [1]; and were dropped, and [3].');
  assert.equal(merged.results[2]!.deadline, null, 'a deadline that is not a date is shown as unknown');
  assert.equal(merged.results[2]!.source, 'other.example.com');
});

test('API: search answers own matches at once, and the web search honestly refuses without a model', async () => {
  const demo = new AgentSystem(new SimBrain({ speed: 0, now: () => new Date(NOW) }), { now: () => new Date(NOW), typingPauseMs: 300 });
  const post = (app: ReturnType<typeof createApp>['app'], path: string, body: unknown) =>
    app.request(`/api/students/demo/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  const off = createApp(new LocalStore(null), {}, { demo }).app;
  const local = await post(off, 'search/local', { query: 'software internship' });
  assert.equal(local.status, 200);
  const body = await local.json();
  assert.equal(body.ai, false);
  assert.ok(Array.isArray(body.results));
  assert.equal((await post(off, 'search', { query: 'software internship' })).status, 503);
  assert.equal((await post(off, 'search/local', { query: 'x' })).status, 400);

  let calls = 0;
  let seen: Parameters<SearchWriter>[0] | null = null;
  const answer = { intent: 'i', answer: 'a', results: [], related: [], contextUsed: [] };
  const writer = cachedSearch(async (input) => (calls++, (seen = input), { data: answer, citations: [] }));
  const on = createApp(new LocalStore(null), {}, { demo, search: writer, grok: { connected: false, mode: 'claude', detail: '' } }).app;
  const res = await post(on, 'search', { query: 'software internship', kind: 'internship' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ...answer, writer: 'claude' });
  assert.equal(seen!.request.kind, 'internship');
  await post(on, 'search', { query: 'software internship', kind: 'internship' });
  assert.equal(calls, 1, 'the same search again is answered from the cache');
});

test('search: the web path looks up once, then ranks with no tools; web off stays one call', async () => {
  const on = SearchRequest.parse({ query: 'stripe intern' });
  const lookup = lookupSystem(on, 't', '2026-11-19');
  assert.match(lookup, /Search for the student's query once/);
  assert.match(lookup, /Open a page only to check a date or deadline/);
  assert.match(lookup, /Then stop/);
  assert.doesNotMatch(lookup, /several quer/i);
  assert.doesNotMatch(lookup, /run several/i);

  const ranking = searchSystem(on, 't', '2026-11-19');
  assert.match(ranking, /Do not search/);
  assert.match(ranking, /Rank and write the answer/);
  assert.doesNotMatch(ranking, /several quer/i);
  assert.doesNotMatch(ranking, /Run several/);
  assert.doesNotMatch(ranking, /Search for the student's query once/);

  const offReq = SearchRequest.parse({ query: 'stripe intern', web: false });
  const off = searchSystem(offReq, 't', '2026-11-19');
  assert.match(off, /Web search is OFF: do not search the web; rank only their own postings/);
  assert.match(off, /Do not use the web\./);
  assert.match(off, /put the matching own posting first/);
  assert.match(off, /Rank only their own postings/);
  assert.doesNotMatch(off, /official page/);
  assert.doesNotMatch(off, /8 to 15/);
  assert.doesNotMatch(off, /several/);
  assert.doesNotMatch(off, /Do not search\. Rank and write the answer/);
  assert.match(ranking, /8 to 15/);

  const seen: Array<Parameters<typeof grokJson>[0]> = [];
  const answer = { intent: 'stripe intern', answer: 'See [1].', results: [], related: ['more'], contextUsed: ['your major'] };
  setSearchModelForTest((async (opts: Parameters<typeof grokJson>[0]) => {
    seen.push(opts);
    if (opts.tools?.some((tool) => tool.type === 'web_search')) {
      return { data: { notes: 'Stripe internship closes 2026-12-01.', urls: ['https://stripe.com/jobs/intern', ''] }, citations: ['https://stripe.com/jobs/intern'] };
    }
    return { data: answer, citations: [] };
  }) as typeof grokJson);
  try {
    const web = await writeSearch({ request: on, context: 'Student: freshman, EECS', own: [] });
    assert.equal(seen.length, 2);
    assert.equal(seen[0]!.name, 'search_lookup');
    assert.deepEqual(seen[0]!.tools, [{ type: 'web_search' }]);
    assert.equal(seen[0]!.maxTurns, 2);
    assert.equal(seen[0]!.schema.safeParse({ notes: 'n', urls: ['https://example.com'] }).success, true);
    assert.equal(seen[0]!.schema.safeParse({ intent: 'i', answer: 'a', results: [], related: [], contextUsed: [] }).success, false);
    assert.match(seen[0]!.system, /Search for the student's query once/);
    assert.match(seen[0]!.system, /Open a page only to check a date or deadline/);
    assert.match(seen[0]!.user, /Query: stripe intern/);
    assert.doesNotMatch(seen[0]!.user, /stripe\.com\/jobs\/intern/);
    assert.doesNotMatch(seen[0]!.system, /several quer/i);

    assert.equal(seen[1]!.name, 'search');
    assert.deepEqual(seen[1]!.tools, []);
    assert.equal(seen[1]!.maxTurns, undefined);
    assert.equal(seen[1]!.schema.safeParse(answer).success, true);
    assert.equal(seen[1]!.schema.safeParse({ notes: 'n', urls: [] }).success, false);
    assert.match(seen[1]!.system, /Do not search/);
    assert.match(seen[1]!.system, /Rank and write the answer/);
    assert.doesNotMatch(seen[1]!.system, /several quer/i);
    assert.doesNotMatch(seen[1]!.system, /Search for the student's query once/);
    assert.match(seen[1]!.user, /Stripe internship closes 2026-12-01/);
    assert.match(seen[1]!.user, /https:\/\/stripe\.com\/jobs\/intern/);
    assert.equal(web.data.intent, 'stripe intern');
    assert.deepEqual(web.citations, ['https://stripe.com/jobs/intern']);

    seen.length = 0;
    const local = await writeSearch({ request: offReq, context: '', own: [] });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.name, 'search');
    assert.deepEqual(seen[0]!.tools, []);
    assert.equal(seen[0]!.maxTurns, undefined);
    assert.match(seen[0]!.system, /Web search is OFF/);
    assert.equal(seen[0]!.schema.safeParse(answer).success, true);
    assert.equal(local.data.intent, 'stripe intern');
  } finally {
    setSearchModelForTest(null);
  }
});
