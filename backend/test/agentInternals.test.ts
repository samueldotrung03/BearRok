import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readablePosting, reviewJob, studentAsk } from '../src/agents/grokBrain.ts';
import { unusableReview } from '../src/agents/system.ts';
import type { Brief } from '../src/agents/types.ts';

const brief: Brief = {
  goal: 'coding and data internships for a freshman',
  hardCriteria: ['open to freshmen', 'near Berkeley, CA or remote', 'still open: deadline not passed'],
  preferences: ['Python work', 'from their note: paid internships only'],
  avoid: [],
  interests: ['coding', 'data'],
  year: 'Freshman',
  location: 'Berkeley, CA',
  remoteOk: true,
  notes: ['paid internships only'],
};

test('worker prompts carry the student request, and reviewers match the keep/reason/fit/record shape', () => {
  const ask = studentAsk(brief);
  assert.match(ask, /Freshman/);
  assert.match(ask, /Berkeley, CA/);
  assert.match(ask, /coding, data/);
  assert.match(ask, /paid internships only/);
  assert.match(ask, /coding and data internships/);
  const criteria = reviewJob('criteria');
  const status = reviewJob('status');
  assert.match(criteria, /undergraduates, all students/);
  assert.match(criteria, /keep to false/);
  assert.match(status, /ongoing club or program/);
  assert.match(status, /deadline has passed/);
  // Both jobs still ask the model for the fields the parser reads: keep, reason, fit, and a record.
  assert.match(criteria, /one sentence/);
  assert.match(status, /one sentence/);
});

test('an empty or placeholder review is not a reason to reject a posting', () => {
  assert.equal(unusableReview('placeholder'), true);
  assert.equal(unusableReview('  Placeholder '), true);
  assert.equal(unusableReview(''), true);
  assert.equal(unusableReview('The deadline passed on September 3.'), false);
  assert.equal(readablePosting({ title: '', sourceUrl: '' }), false);
  assert.equal(readablePosting({ title: 'placeholder', sourceUrl: 'https://example.org/x' }), false);
  assert.equal(readablePosting({ title: 'STEP Intern', sourceUrl: 'https://buildyourfuture.withgoogle.com/programs/step' }), true);
});
