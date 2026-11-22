// The match score and the student's minimum match: what the criteria reviewer scores, what the
// threshold keeps, and the hard checks that drop a posting whatever it scores.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from '../src/app.ts';
import { criteriaVerdict } from '../src/agents/grokBrain.ts';
import { clampPercent, cleanThreshold, DEFAULT_MATCH_THRESHOLD, hardCheck, meetsThreshold, normalizeMatch, thresholdOf } from '../src/agents/match.ts';
import { SimBrain, simMatch } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Assignment, Brief, Candidate, ReviewFocus, ScoutSpec } from '../src/agents/types.ts';
import { LocalStore } from '../src/store/local.ts';

const NOW = new Date('2026-11-21T22:00:00Z');
const system = (opts = {}) => new AgentSystem(new SimBrain({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, ...opts });

// ---- the score itself ------------------------------------------------------------------------

test('match: scores are clamped to whole percents, and a missing score is worked out from the factors', () => {
  assert.equal(clampPercent(-5, 50), 0);
  assert.equal(clampPercent(140, 50), 100);
  assert.equal(clampPercent(45.6, 50), 46);
  assert.equal(clampPercent('72', 50), 72);
  assert.equal(clampPercent(Number.NaN, 50), 50);
  assert.equal(clampPercent(undefined, 50), 50);

  const m = normalizeMatch({
    score: 180,
    reason: '  Strong on interests.\nSecond line ignored',
    factors: [
      { factor: 'interests', score: 120, note: 'ai' },
      { factor: 'Year', score: -3, note: 'open to freshmen' },
      { factor: 'interests', score: 10, note: 'a repeat, left out' },
      { factor: 'salary', score: 90, note: 'not a factor' },
      { factor: 'notes', score: 'n/a', note: 'no number' },
    ],
  });
  assert.equal(m.score, 100);
  assert.equal(m.reason, 'Strong on interests.');
  // Unknown factors, repeats and ones without a number are left out; the rest are clamped and in order.
  assert.deepEqual(m.factors, [
    { factor: 'interests', score: 100, note: 'ai' },
    { factor: 'year', score: 0, note: 'open to freshmen' },
  ]);

  // No overall score: the weighted factors give it (interests count twice as much as location).
  const worked = normalizeMatch({ factors: [{ factor: 'interests', score: 90, note: '' }, { factor: 'location', score: 30, note: '' }] });
  assert.equal(worked.score, 70);
  assert.match(worked.reason, /70%/);
  // Nothing at all: neutral, never a silent 0 that would drop the posting.
  assert.equal(normalizeMatch(null).score, 50);
  assert.deepEqual(normalizeMatch({}).factors, []);
});

test('match: the minimum match is a whole percent from 0 to 100, 30 by default', () => {
  assert.equal(DEFAULT_MATCH_THRESHOLD, 30);
  assert.equal(cleanThreshold(30), 30);
  assert.equal(cleanThreshold(0), 0);
  assert.equal(cleanThreshold(100), 100);
  assert.equal(cleanThreshold(30.4), 30);
  for (const bad of [-1, 101, Number.NaN, Infinity, '30', null, undefined, true]) assert.equal(cleanThreshold(bad), null, String(bad));
  assert.equal(thresholdOf({}), 30);
  assert.equal(thresholdOf({ matchThreshold: 55 }), 55);
  assert.equal(thresholdOf({ matchThreshold: 400 }), 30);
  // At or above the minimum is kept.
  assert.equal(meetsThreshold(29, 30), false);
  assert.equal(meetsThreshold(30, 30), true);
  assert.equal(meetsThreshold(31, 30), true);
});

test('match: the Grok criteria answer is parsed into a kept verdict whose fit is the score', () => {
  const record = { title: 'x' } as Candidate;
  const v = criteriaVerdict({ reason: 'Close to what you asked for', match: { score: 64.4, factors: [{ factor: 'roles', score: 80, note: 'ml engineer' }] }, record });
  assert.equal(v.keep, true);
  assert.equal(v.match!.score, 64);
  assert.equal(v.fit, 0.64);
  assert.equal(v.reason, 'Close to what you asked for');
  assert.deepEqual(v.match!.factors, [{ factor: 'roles', score: 80, note: 'ml engineer' }]);
});

test('hard checks: fake or closed, expired, or with no real link fail whatever the score', () => {
  const ok = { sourceUrl: 'https://example.org/job', deadline: '2026-12-15T23:59:00-08:00' };
  assert.equal(hardCheck(ok, { keep: true, reason: 'Open' }, NOW), null);
  assert.equal(hardCheck({ ...ok, deadline: null }, { keep: true, reason: 'Open' }, NOW), null);
  assert.equal(hardCheck(ok, { keep: false, reason: 'The careers page returns 404' }, NOW), 'The careers page returns 404');
  assert.match(hardCheck({ ...ok, deadline: '2026-11-01T00:00:00Z' }, { keep: true, reason: 'Open' }, NOW)!, /^Expired: the deadline passed on 2026-11-01/);
  for (const url of ['placeholder', 'ftp://example.org/x', 'example.org/job', '', 'https://localhost']) assert.equal(hardCheck({ ...ok, sourceUrl: url }, { keep: true, reason: 'Open' }, NOW), 'No real web link to the posting', url);
});

// ---- the threshold in a run ------------------------------------------------------------------

type Posting = { slug: string; score: number; status?: string; deadline?: string; sourceUrl?: string };
/** Internships with fixed match scores, and status answers chosen per posting. */
class FixedBrain extends SimBrain {
  private postings: Posting[];
  constructor(postings: Posting[]) {
    super({ speed: 0, now: () => NOW });
    this.postings = postings;
  }
  override async planJobs(assignment: Assignment, brief: Brief, past: string[] = []): Promise<ScoutSpec[]> {
    if (assignment.category !== 'internship') return super.planJobs(assignment, brief, past);
    // Two scouts, since each brings back at most four leads.
    return [
      { label: 'fixed a', query: 'fixed internships a', lensValue: 'a' },
      { label: 'fixed b', query: 'fixed internships b', lensValue: 'b' },
    ];
  }
  override async scout(spec: ScoutSpec, assignment: Assignment) {
    if (assignment.category !== 'internship') return [];
    const half = Math.ceil(this.postings.length / 2);
    const mine = spec.lensValue === 'a' ? this.postings.slice(0, half) : this.postings.slice(half);
    return mine.map((p) => ({ title: p.slug, url: `https://jobs.example.org/${p.slug}` }));
  }
  override async extract(lead: { title: string; url: string }): Promise<Candidate | null> {
    const p = this.postings.find((x) => lead.url.endsWith(`/${x.slug}`))!;
    return {
      type: 'internship', title: p.slug, organizer: `Org ${p.slug}`, sourceUrl: lead.url, actionUrl: null, format: 'online', location: null, field: 'ai', tags: [],
      eligibility: null, eligibleYears: null, deadline: '2026-12-15T23:59:00-08:00', deadlineSource: 'official', startTime: null, image: null, evidence: [],
    };
  }
  override async validate(candidate: Candidate, _brief: Brief, _memory: unknown, focus: ReviewFocus) {
    const p = this.postings.find((x) => x.slug === candidate.title)!;
    const record = { ...candidate, ...(p.deadline ? { deadline: p.deadline } : {}), ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}) };
    if (focus === 'status') return p.status ? { keep: false, reason: p.status, fit: 0, record } : { keep: true, reason: 'Open: the page is up', fit: 1, record };
    const match = normalizeMatch({ score: p.score, factors: [{ factor: 'interests', score: p.score, note: 'set by the test' }], reason: `Scored ${p.score}` });
    return { keep: true, reason: match.reason, fit: match.score / 100, match, record };
  }
}

const fixedSystem = (postings: Posting[]) => new AgentSystem(new FixedBrain(postings), { now: () => NOW, typingPauseMs: 300, feedTarget: 0, maxJobs: 40 });
const titles = (s: AgentSystem) => s.student().feed.map((f) => f.opportunity.title).filter((t) => t.startsWith('m-') || t.startsWith('h-')).sort();

test('threshold: at the default 30, a 29% match is dropped and 30% and 31% are kept', async () => {
  const s = fixedSystem([{ slug: 'm-29', score: 29 }, { slug: 'm-30', score: 30 }, { slug: 'm-31', score: 31 }]);
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  assert.deepEqual(titles(s), ['m-30', 'm-31']);
  const low = run.validations.find((v) => v.title === 'm-29')!;
  assert.equal(low.status, 'rejected');
  assert.equal(low.belowThreshold, true);
  assert.match(low.reason!, /^Below your minimum match: 29% \(minimum 30%\)/);
  assert.equal(run.validations.find((v) => v.title === 'm-30')!.status, 'kept');
  // The card carries its match, and the old 0-to-1 fit agrees with it.
  const card = s.student().feed.find((f) => f.opportunity.title === 'm-31')!.opportunity;
  assert.equal(card.match!.score, 31);
  assert.equal(card.baseScore, 0.31);
  // run.stats and the funnel count what fell under the minimum, apart from hard-check rejections.
  assert.equal(run.stats.threshold, 30);
  assert.ok(run.stats.belowThreshold! >= 1);
  assert.equal(run.stats.funnel!.threshold, 30);
  assert.equal(run.stats.funnel!.belowThreshold, run.stats.belowThreshold);
  assert.ok(!run.stats.funnel!.rejectedReasons.some((r) => r.reason.startsWith('Below your minimum')));
  assert.ok(run.log.some((l) => l.text.startsWith('Left out "m-29": 29% match, below your minimum of 30%')));
});

test('threshold: the student can move it; 31 drops the 30% match and 29 keeps the 29% one', async () => {
  for (const [threshold, kept] of [[31, ['m-31']], [29, ['m-29', 'm-30', 'm-31']], [0, ['m-29', 'm-30', 'm-31']]] as const) {
    const s = fixedSystem([{ slug: 'm-29', score: 29 }, { slug: 'm-30', score: 30 }, { slug: 'm-31', score: 31 }]);
    assert.equal(s.setMatchThreshold(threshold), threshold);
    await s.trigger('manual');
    await s.idle();
    assert.deepEqual(titles(s), [...kept], `minimum ${threshold}`);
    assert.equal(s.currentRun()!.stats.threshold, threshold);
  }
});

test('hard checks: a 99% match that is closed, fake, expired or has no real link is still dropped', async () => {
  const s = fixedSystem([
    { slug: 'h-closed', score: 99, status: 'Applications closed on 2026-10-01 for this cycle.' },
    { slug: 'h-fake', score: 99, status: 'The careers page returns 404 Not Found.' },
    { slug: 'h-expired', score: 99, deadline: '2026-11-01T23:59:00-08:00' },
    { slug: 'h-nolink', score: 99, sourceUrl: 'ftp://jobs.example.org/h-nolink' },
    { slug: 'h-good', score: 99 },
  ]);
  // Even with no minimum at all.
  s.setMatchThreshold(0);
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  assert.deepEqual(titles(s), ['h-good']);
  const why = (t: string) => run.validations.find((v) => v.title === t)!;
  assert.match(why('h-closed').reason!, /^Status reviewer: Applications closed/);
  assert.match(why('h-fake').reason!, /^Status reviewer: The careers page returns 404/);
  assert.match(why('h-expired').reason!, /^Hard check: Expired: the deadline passed on 2026-11-02/);
  assert.match(why('h-nolink').reason!, /^Hard check: No real web link/);
  for (const t of ['h-closed', 'h-fake', 'h-expired', 'h-nolink']) assert.notEqual(why(t).belowThreshold, true, t);
  assert.ok(run.stats.rejected >= 4);
  // Hard-check rejections are final; none of them is waiting for a lower minimum.
  const learned = s.memorySnapshot().learned;
  assert.ok(!learned.lowMatch?.some((m) => m.url.includes('/h-')));
});

test('threshold: lowering the minimum lets a posting left out earlier back in on the next search; raising it hides cards at once', async () => {
  const s = fixedSystem([{ slug: 'm-20', score: 20 }, { slug: 'm-45', score: 45 }, { slug: 'm-80', score: 80 }]);
  await s.trigger('manual');
  await s.idle();
  assert.deepEqual(titles(s), ['m-45', 'm-80']);
  assert.equal(s.memorySnapshot().learned.lowMatch?.find((m) => m.url.endsWith('/m-20'))?.score, 20);

  // Still below the minimum: not reviewed again.
  await s.trigger('manual');
  await s.idle();
  assert.ok(!s.currentRun()!.validations.some((v) => v.title === 'm-20'));
  assert.equal(s.currentRun()!.stats.funnel!.alreadyBelowThreshold, 1);

  // Lowered: found and reviewed again, and kept.
  s.setMatchThreshold(10);
  await s.trigger('manual');
  await s.idle();
  assert.deepEqual(titles(s), ['m-20', 'm-45', 'm-80']);

  // Raised: the feed holds only cards at or above it straight away, without a search. Saved ones stay saved.
  const m45 = s.student().feed.find((f) => f.opportunity.title === 'm-45')!.opportunity.id;
  s.interact(m45, 'save');
  s.setMatchThreshold(50);
  assert.deepEqual(titles(s), ['m-80']);
  assert.ok(s.student().savedItems.some((e) => e.opportunity.id === m45));
  assert.equal(s.student().matchThreshold, 50);
});

// ---- the preference ------------------------------------------------------------------------

test('preference: matchThreshold is saved through the preferences endpoint, validated, kept with the profile, and read by the next run', async () => {
  const s = system({ feedTarget: 0 });
  const { app } = createApp(new LocalStore(null), {}, { demo: s });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(`/api/students/demo${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as any };
  };
  assert.equal((await call('GET', '/preferences')).body.matchThreshold, 30);
  const saved = await call('PUT', '/preferences', { matchThreshold: 55 });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.matchThreshold, 55);
  assert.equal((await call('GET', '/preferences')).body.matchThreshold, 55);

  // Out of range or not a number: refused, and nothing changes.
  for (const bad of [101, -1, '40', null]) {
    const res = await call('PUT', '/preferences', { matchThreshold: bad, reminderDays: [1] });
    assert.equal(res.status, 400, String(bad));
    assert.match(res.body.error, /0 to 100/);
  }
  assert.equal((await call('GET', '/preferences')).body.matchThreshold, 55);
  assert.deepEqual((await call('GET', '/preferences')).body.reminderDays, [7, 2, 0]);

  // The Profile page saves its whole preferences object; the minimum match is not wiped by it.
  await call('PUT', '/profile', { preferences: { fields: ['AI / ML'], notes: [] } });
  assert.equal((await call('GET', '/preferences')).body.matchThreshold, 55);
  assert.equal(s.student().profile.matchThreshold, 55);

  // Read by the next run.
  await s.trigger('manual');
  await s.idle();
  assert.equal(s.currentRun()!.stats.threshold, 55);
  assert.ok(s.student().feed.every((f) => !f.opportunity.match || f.opportunity.match.score >= 55));

  // Kept with the account: a restart puts it back.
  const again = system({ feedTarget: 0 });
  again.restore(structuredClone(s.memorySnapshot()));
  assert.equal(again.getMatchThreshold(), 55);
  assert.equal(again.student().matchThreshold, 55);
});

// ---- the simulated reviewer ------------------------------------------------------------------

test('simulated reviewer: scores vary across postings, with a breakdown and a reason, so the threshold can be tried offline', async () => {
  const s = system({ feedTarget: 0, maxJobs: 40 });
  s.setMatchThreshold(0);
  await s.trigger('first');
  await s.idle();
  const scores = s.currentRun()!.validations.filter((v) => v.match).map((v) => v.match!.score);
  assert.ok(scores.length > 10);
  assert.ok(new Set(scores).size >= 8, `varied: ${scores.join(', ')}`);
  assert.ok(scores.some((x) => x < 30) && scores.some((x) => x >= 30 && x < 60) && scores.some((x) => x >= 60), `spread: ${scores.join(', ')}`);
  for (const v of s.currentRun()!.validations.filter((x) => x.match)) {
    assert.ok(v.match!.factors.length >= 3, v.title);
    assert.ok(v.match!.reason.length > 10, v.title);
  }

  // Rules the student set keep a posting under the default minimum.
  const brief: Brief = { goal: '', hardCriteria: ['remote only'], preferences: [], avoid: [], interests: ['ai'], year: 'Freshman', location: 'Berkeley, CA', remoteOk: true, notes: ['No finance, please'] };
  const base: Candidate = { type: 'internship', title: 'ML intern', organizer: 'Org', sourceUrl: 'https://example.org/ml', actionUrl: null, format: 'online', location: null, field: 'ai', tags: [], eligibility: null, eligibleYears: null, deadline: null, startTime: null, image: null, evidence: [] };
  assert.ok(simMatch(base, brief, { avoidFields: [] }).score >= 50);
  assert.ok(simMatch({ ...base, eligibleYears: ['Junior', 'Senior'] }, brief, { avoidFields: [] }).score <= 12);
  assert.ok(simMatch({ ...base, format: 'in_person', location: 'Berkeley, CA' }, brief, { avoidFields: [] }).score <= 15);
  assert.ok(simMatch({ ...base, field: 'finance', title: 'Finance intern' }, brief, { avoidFields: [] }).score <= 8);
});
