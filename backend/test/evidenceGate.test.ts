import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Brain, MasterInput } from '../src/agents/brain.ts';
import { normalizeMatch } from '../src/agents/match.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Assignment, Candidate, FoundDeadline, Lead, Opportunity, ReviewFocus } from '../src/agents/types.ts';

const NOW = new Date('2026-11-25T20:00:00Z');
const DEADLINE = '2026-12-15T23:59:00-08:00';
const CLOSE = 'Applications close on December 15, 2026.';
const SUMMER = 'The internship runs for twelve weeks in summer.';
const HTML = `<html><body><p>Applications close on <b>December 15, 2026</b>.</p><p>The internship runs for twelve weeks in summer.</p></body></html>`;
const url = (slug: string) => `https://jobs.example.org/${slug}`;

function posting(slug: string, over: Partial<Candidate> = {}): Candidate {
  const sourceUrl = over.sourceUrl ?? url(slug);
  return {
    type: 'internship',
    title: slug,
    organizer: 'Example Org',
    sourceUrl,
    actionUrl: null,
    format: 'online',
    location: null,
    field: 'software',
    tags: [],
    eligibility: null,
    eligibleYears: null,
    deadline: DEADLINE,
    deadlineSource: 'official',
    startTime: null,
    image: null,
    evidence: [{ field: 'deadline', quote: CLOSE, url: sourceUrl }],
    ...over,
    title: slug,
    sourceUrl,
  };
}

class TinyBrain implements Brain {
  mode: 'simulated' | 'live';
  private candidates: Candidate[];
  private listing: FoundDeadline | null;

  constructor(opts: { mode?: 'simulated' | 'live'; candidates: Candidate[]; listing?: FoundDeadline | null }) {
    this.mode = opts.mode ?? 'live';
    this.candidates = opts.candidates;
    this.listing = opts.listing ?? null;
  }

  async master(input: MasterInput) {
    return {
      brief: {
        goal: 'internships',
        hardCriteria: [],
        preferences: [],
        avoid: [],
        interests: ['coding'],
        year: input.profile.year,
        location: input.profile.location,
        remoteOk: true,
        notes: [],
      },
      assignments: input.assignments,
    };
  }

  async planJobs(assignment: Assignment) {
    if (assignment.category !== 'internship' && assignment.kind !== 'internship') return [];
    return [{ label: 'fixed', query: 'fixed internships', lensValue: 'fixed' }];
  }

  async scout() {
    return this.candidates.map((c) => ({ title: c.title, url: c.sourceUrl }));
  }

  async extract(lead: Lead) {
    return this.candidates.find((c) => c.sourceUrl === lead.url) ?? null;
  }

  async readApplication() {
    return { prompts: [], materials: [] };
  }

  async findDeadline() {
    return this.listing;
  }

  async illustrate() {
    return null;
  }

  async sortEvents(events: { id: string }[]) {
    return events.map((e) => ({ id: e.id, career: false, kind: 'personal' as const, reason: 'unused' }));
  }

  async draftEvent() {
    return { ok: false as const, reply: 'unused' };
  }

  async validate(candidate: Candidate, _brief: unknown, _memory: unknown, focus: ReviewFocus) {
    if (focus === 'status') return { keep: true, reason: 'Open: the page is up', fit: 1, record: candidate };
    const match = normalizeMatch({ score: 80, reason: 'Fits the brief.', factors: [{ factor: 'interests', score: 80, note: 'coding' }] });
    return { keep: true, reason: match.reason, fit: match.score / 100, match, record: candidate };
  }

  async present(kept: Opportunity[]) {
    return new Map(kept.map((o) => [o.id, 'Fits.']));
  }
}

function fakeFetch(pages: Record<string, { status: number; html?: string }>, calls: { n: number }): typeof fetch {
  return async (input) => {
    calls.n++;
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const page = pages[href];
    if (!page) return new Response('', { status: 404 });
    return new Response(page.html ?? '', { status: page.status, headers: { 'content-type': 'text/html' } });
  };
}

async function runLive(
  candidates: Candidate[],
  pages: Record<string, { status: number; html?: string }>,
  extra: { mode?: 'simulated' | 'live'; listing?: FoundDeadline | null } = {},
) {
  const calls = { n: 0 };
  const s = new AgentSystem(
    new TinyBrain({ mode: extra.mode ?? 'live', candidates, listing: extra.listing ?? null }),
    { now: () => NOW, feedTarget: 0, slots: 1, maxJobs: 8, fetch: fakeFetch(pages, calls) },
    { categories: ['internship'] },
  );
  await s.trigger('first');
  await s.idle();
  return { s, calls };
}

const card = (s: AgentSystem, title: string) => s.student().feed.map((f) => f.opportunity).find((o) => o.title === title);

test('unreachable source drops the card', async () => {
  const { s } = await runLive([posting('gone')], { [url('gone')]: { status: 404 } });
  assert.equal(card(s, 'gone'), undefined);
  const v = s.currentRun()!.validations.find((x) => x.title === 'gone')!;
  assert.equal(v.status, 'rejected');
  assert.match(v.reason!, /not found/i);
});

test('a deadline quote present on the fixture HTML is kept', async () => {
  const { s } = await runLive([posting('quoted')], { [url('quoted')]: { status: 200, html: HTML } });
  const o = card(s, 'quoted')!;
  assert.equal(o.deadline, DEADLINE);
  assert.equal(o.deadlineSource, 'official');
  assert.ok(!o.unknowns.some((u) => u.field === 'deadline'));
});

test('a stitched quote is kept only when each of its sentences appears, and is cleared when one sentence is absent', async () => {
  const { s } = await runLive(
    [
      posting('both', { evidence: [{ field: 'deadline', quote: `${CLOSE} ${SUMMER}`, url: url('both') }] }),
      posting('gap', { evidence: [{ field: 'deadline', quote: `${CLOSE} Offers go out in January after interviews.`, url: url('gap') }] }),
    ],
    { [url('both')]: { status: 200, html: HTML }, [url('gap')]: { status: 200, html: HTML } },
  );
  const both = card(s, 'both')!;
  const gap = card(s, 'gap')!;
  assert.equal(both.deadline, DEADLINE);
  assert.equal(both.deadlineSource, 'official');
  assert.equal(gap.deadline, null);
  assert.equal(gap.deadlineSource, null);
  assert.ok(gap.unknowns.some((u) => u.field === 'deadline' && u.label === 'Application deadline unknown'));
});

test('a blocked link keeps the card and clears the deadline', async () => {
  const { s } = await runLive([posting('walled')], { [url('walled')]: { status: 403 } });
  const o = card(s, 'walled')!;
  assert.equal(o.deadline, null);
  assert.equal(o.deadlineSource, null);
  assert.ok(o.unknowns.some((u) => u.field === 'deadline' && u.label === 'Application deadline unknown'));
});

test('a simulated brain does not call fetch', async () => {
  const { s, calls } = await runLive([posting('sim')], { [url('sim')]: { status: 200, html: HTML } }, { mode: 'simulated' });
  assert.ok(card(s, 'sim'));
  assert.equal(calls.n, 0);
});

test('deadline finder stores a listing quote only when it is on that page', async () => {
  const listing = { deadline: DEADLINE, url: 'https://listings.example/post', quote: CLOSE };
  const undated = posting('undated', { deadline: null, deadlineSource: null, evidence: [] });
  const { s } = await runLive([undated], { [url('undated')]: { status: 200, html: '<p>A research internship.</p>' }, [listing.url]: { status: 200, html: HTML } }, { listing });
  const o = card(s, 'undated')!;
  assert.equal(o.deadline, new Date(DEADLINE).toISOString());
  assert.equal(o.deadlineSource, 'listing');
  assert.ok(!o.unknowns.some((u) => u.field === 'deadline'));
});

test('deadline finder leaves the deadline unknown when the listing quote is not on that page', async () => {
  const listing = { deadline: DEADLINE, url: 'https://listings.example/missing', quote: CLOSE };
  const undated = posting('undated2', { deadline: null, deadlineSource: null, evidence: [] });
  const { s } = await runLive([undated], { [url('undated2')]: { status: 200, html: '<p>A research internship.</p>' }, [listing.url]: { status: 200, html: '<p>Unrelated listing copy.</p>' } }, { listing });
  const o = card(s, 'undated2')!;
  assert.equal(o.deadline, null);
  assert.equal(o.deadlineSource, null);
  assert.ok(o.unknowns.some((u) => u.field === 'deadline'));
});
