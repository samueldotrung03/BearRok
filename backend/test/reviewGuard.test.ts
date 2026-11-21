import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criteriaBrief, reviewJob } from '../src/agents/grokBrain.ts';
import { groundlessReject } from '../src/agents/reviewGuard.ts';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import type { Assignment, Brief, Candidate, ReviewFocus, ScoutSpec } from '../src/agents/types.ts';

const NOW = new Date('2026-11-21T22:00:00Z');

// The six rejections the live validators gave a freshman on 2026-11-21, word for word (two status
// reasons were the word placeholder, which unusableReview already sets aside). Each
// posting needs both reviewers to keep it, so it stays rejected if either reason still stands.
const LIVE: { criteria: string; status: string | null; criteriaStands: boolean; statusStands: boolean }[] = [
  {
    criteria: 'The join page says applications were due Thursday, September 3 at noon, so freshman eligibility and a Berkeley club do not make this cycle still open.',
    status: 'The organizer’s join page cannot be found; the site returns a missing page, so whether fall 2026 applications are still open cannot be confirmed.',
    criteriaStands: false,
    statusStands: true,
  },
  {
    criteria: 'The page does not confirm freshmen may apply: it only says undergraduates enrolled in any UC Berkeley program are eligible, with no year restriction stated and no first-year confirmation.',
    status: null, // "placeholder": not a decision, handled by unusableReview
    criteriaStands: false,
    statusStands: false,
  },
  {
    criteria: "The organizer's pages do not state that freshmen or first-year undergraduates may join staff, so the freshman hard criterion cannot be confirmed.",
    status: null, // "placeholder"
    criteriaStands: false,
    statusStands: false,
  },
  {
    criteria: 'The OCF page confirms an ongoing Berkeley student-organization membership open to all currently enrolled students, but it is a free computing-account service rather than a coding or data project club the student is looking for.',
    status: 'I could not confirm the OCF membership page still exists and that account registration is open today.',
    criteriaStands: true,
    statusStands: false,
  },
  {
    criteria: "A note does not rule it out and the page confirms a Berkeley student club open to any year including freshmen, but the recruiting timeline is for Fall '26 and today is 2026-11-21, so the page does not confirm that applications or registration are still open.",
    status: "The Fall '26 recruiting window on CALICO's own join page has passed: the interest form was due Wednesday, September 2, 2026, and the page gives no later cycle that is still open.",
    criteriaStands: false,
    statusStands: true,
  },
  {
    criteria: 'The club page says SUSA is being reorganized as of Spring 2025 and sign-ups are not open yet, so membership for 2026 cannot be confirmed as still open.',
    status: 'The organizer’s own site still says SUSA is being reorganized as of Spring 2025 and that sign-ups will come later, so membership is not open on 2026-11-21.',
    criteriaStands: false,
    statusStands: true,
  },
];

test('review guard: of the live run\'s rejections, only the ones the page backs still stand', () => {
  for (const r of LIVE) {
    assert.equal(groundlessReject('criteria', r.criteria) === null, r.criteriaStands, r.criteria);
    if (r.status) assert.equal(groundlessReject('status', r.status) === null, r.statusStands, r.status);
  }
  // Rejections the page backs are never overruled.
  for (const [focus, reason] of [
    ['criteria', 'Not open to freshmen: open to juniors and seniors only'],
    ['criteria', "The student's notes rule this out (finance)"],
    ['criteria', 'In person in Austin, TX, and the student wants near Berkeley, CA or remote'],
    ['criteria', 'The page does not state a year, but it requires current enrollment in a PhD program'],
    ['status', 'The careers page returns 404 Not Found'],
    ['status', 'Closed: the deadline passed on 2026-11-16'],
    ['status', 'Could not be reviewed: page timed out'],
  ] as [ReviewFocus, string][]) {
    assert.equal(groundlessReject(focus, reason), null, reason);
  }
});

test('review guard: the criteria reviewer is not asked to judge whether a posting is open', () => {
  const brief: Brief = {
    year: 'Freshman', location: 'Berkeley, CA', remoteOk: true, goal: 'AI/ML internships', interests: ['ai', 'data'], preferences: [], avoid: [], notes: [],
    hardCriteria: ['Open to freshmen', 'Near Berkeley, CA or remote', 'Still open with a deadline ahead', 'Accepting applications now', 'states a deadline'],
  };
  assert.deepEqual(criteriaBrief(brief).hardCriteria, ['Open to freshmen', 'Near Berkeley, CA or remote']);
  assert.match(reviewJob('criteria'), /Do not judge whether it is still open/);
  assert.match(reviewJob('criteria'), /cannot confirm it, it does not fail/);
  assert.match(reviewJob('status'), /even if you cannot confirm today's status/);
});

// AI/ML internship postings of the kind a freshman near Berkeley gets back, with reviewer answers
// in the words the live reviewers use. Three were over-rejected before; four are real rejections.
type Posting = { title: string; organizer: string; slug: string; criteria?: string; status?: string; kept: boolean };
const POSTINGS: Posting[] = [
  { title: 'Machine Learning Engineering Intern (Summer 2027)', organizer: 'Lumen Robotics', slug: 'ml-eng-intern', criteria: 'The posting does not state whether freshmen may apply, so the freshman hard criterion cannot be confirmed.', kept: true },
  { title: 'Data Science and ML Intern', organizer: 'Harbor Health', slug: 'ds-ml-intern', criteria: 'Undergraduates are welcome, but the page gives a deadline of 2026-12-15, so it is not clear this cycle is still open.', kept: true },
  { title: 'NLP Intern, Applied AI', organizer: 'Quill Labs', slug: 'nlp-intern', status: 'I could not verify that applications are still being accepted today.', kept: true },
  { title: 'AI Research Intern, Computer Vision', organizer: 'Northfield AI Lab', slug: 'cv-research-intern', criteria: 'Open only to PhD students in computer science or a related field.', kept: false },
  { title: 'Generative AI Product Intern', organizer: 'Brightline', slug: 'genai-product-intern', status: 'The careers page returns 404 Not Found.', kept: false },
  { title: 'Undergraduate ML Fellowship', organizer: 'Bay Compute Institute', slug: 'ml-fellowship', status: 'Applications closed on 2026-10-01 for this cycle.', kept: false },
  { title: 'Robotics and Embodied AI Intern', organizer: 'Keel Robotics', slug: 'embodied-ai-intern', criteria: 'In person in Pittsburgh, PA, and the student wants near Berkeley, CA or remote.', kept: false },
];
const urlOf = (p: Posting) => `https://careers.example.org/${p.slug}`;

class AimlBrain extends SimBrain {
  override async planJobs(assignment: Assignment, brief: Brief, past: string[] = []): Promise<ScoutSpec[]> {
    if (assignment.category !== 'internship') return super.planJobs(assignment, brief, past);
    return [
      { label: 'ai internships', query: 'machine learning intern freshman', lensValue: 'ai' },
      { label: 'data internships', query: 'data science intern undergraduate', lensValue: 'data' },
    ];
  }
  override async scout(spec: ScoutSpec, assignment: Assignment) {
    if (assignment.category !== 'internship') return [];
    const mine = spec.lensValue === 'ai' ? POSTINGS.slice(0, 4) : POSTINGS.slice(4);
    return mine.map((p) => ({ title: p.title, url: urlOf(p) }));
  }
  override async extract(lead: { title: string; url: string }): Promise<Candidate | null> {
    const p = POSTINGS.find((x) => urlOf(x) === lead.url)!;
    return {
      type: 'internship', title: p.title, organizer: p.organizer, sourceUrl: urlOf(p), actionUrl: `${urlOf(p)}/apply`, format: 'hybrid', location: 'San Francisco, CA',
      field: 'ai', tags: ['machine learning', 'python'], eligibility: 'Undergraduates', eligibleYears: null, deadline: '2026-12-15T23:59:00-08:00', deadlineSource: 'official',
      startTime: null, image: null, evidence: [],
    };
  }
  override async validate(candidate: Candidate, _brief: Brief, _memory: unknown, focus: ReviewFocus) {
    const p = POSTINGS.find((x) => x.title === candidate.title)!;
    const said = focus === 'criteria' ? p.criteria : p.status;
    return said ? { keep: false, reason: said, fit: 0, record: candidate } : { keep: true, reason: focus === 'criteria' ? 'A good AI/ML fit for a freshman' : 'Open: applications close 2026-12-15', fit: 0.8, record: candidate };
  }
}

test('validators: realistic AI/ML internships are kept unless the page itself rules the student out', async () => {
  const s = new AgentSystem(new AimlBrain({ speed: 0, now: () => NOW }), { now: () => NOW, typingPauseMs: 300, feedTarget: 0, maxJobs: 40 });
  await s.trigger('manual');
  await s.idle();
  const run = s.currentRun()!;
  const byTitle = new Map(run.validations.map((v) => [v.title, v]));
  for (const p of POSTINGS) {
    const v = byTitle.get(p.title);
    assert.ok(v, `${p.title} was reviewed`);
    assert.equal(v.status, p.kept ? 'kept' : 'rejected', `${p.title}: ${v.reason}`);
  }
  const feed = s.student().feed.map((f) => f.opportunity.title);
  for (const p of POSTINGS) assert.equal(feed.includes(p.title), p.kept, p.title);
  // The student sees why each one fits, never the reviewer's doubt.
  const ml = s.student().feed.find((f) => f.opportunity.title === POSTINGS[0]!.title)!;
  assert.doesNotMatch(ml.opportunity.fitExplanation ?? '', /cannot be confirmed/);
  // Every overruled rejection is in the log, with what the reviewer said.
  const overruled = run.log.filter((l) => l.text.startsWith('Overruled its rejection'));
  assert.equal(overruled.length, 3);
  assert.ok(overruled.some((l) => l.text.includes('could not verify')));
  // Real rejections are remembered, so the same posting is not checked again.
  const remembered = s.memorySnapshot().learned.rejected.map((r) => r.url);
  for (const p of POSTINGS.filter((x) => !x.kept)) assert.ok(remembered.some((u) => u.includes(p.slug)), p.slug);
  assert.equal(run.stats.funnel!.kept, 3 + run.validations.filter((v) => !POSTINGS.some((p) => p.title === v.title) && v.status === 'kept').length);
});
