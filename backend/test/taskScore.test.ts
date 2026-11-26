import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FIXED_CLOCK,
  hydrateTask,
  pageText,
  quoteSupported,
  scoreTask,
  type AgentTask,
  type AgentTaskSource,
  type KeptCard,
} from '../src/agents/taskScore.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'agent-tasks');

function loadTasks(): AgentTask[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(DIR, name), 'utf8')) as AgentTaskSource;
      return hydrateTask(raw, (file) => readFileSync(join(DIR, file), 'utf8'));
    });
}

const TASKS = loadTasks();

function byCover(covers: string): AgentTask {
  const task = TASKS.find((t) => t.covers === covers);
  assert.ok(task, `missing task covering ${covers}`);
  return task;
}

function urlOf(task: AgentTask, fragment?: string): string {
  const urls = Object.keys(task.pages);
  const hit = fragment ? urls.find((u) => u.includes(fragment)) : urls[0];
  assert.ok(hit, `no page url on ${task.id}`);
  return hit;
}

function card(title: string, url: string, deadline: string | null, deadlineQuote: string | null): KeptCard {
  return { title, url, deadline, deadlineQuote };
}

test('quote support: strip tags, collapse whitespace, drop emoji, and long sentences must appear', () => {
  const html = '<p>Applications close on <strong>December 18, 2026</strong> at 11:59 pm Pacific. 🎉</p>';
  assert.equal(pageText(html), 'Applications close on December 18, 2026 at 11:59 pm Pacific.');
  assert.equal(quoteSupported('Applications close on December 18, 2026 at 11:59 pm Pacific.', html), true);
  assert.equal(quoteSupported('Applications   close on December 18, 2026 at 11:59 pm Pacific.', html), true);
  assert.equal(quoteSupported('This sentence is nowhere on the page at all.', html), false);
  assert.equal(quoteSupported('Hi.', html), false);
  const two = 'Applications close on December 18, 2026 at 11:59 pm Pacific. Interviews begin in March 2027.';
  assert.equal(quoteSupported(two, html), false);
  assert.equal(FIXED_CLOCK, '2026-11-25');
});

test('score: a correct feed passes', () => {
  const task = byCover('pass');
  const url = urlOf(task);
  const title = task.expected.required[0]!.title;
  const quote = 'Applications close on December 18, 2026 at 11:59 pm Pacific.';
  const result = scoreTask(task, [card(title, url, '2026-12-18T23:59:00-08:00', quote)]);
  assert.equal(result.score, 1);
  assert.equal(result.pass, true);
  assert.deepEqual(result.reasons, []);
});

test('score: a closed posting in the feed fails', () => {
  const task = byCover('closed-posting');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), null, null)]);
  assert.equal(result.pass, false);
  assert.equal(result.score, 0);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: a login wall with no facts in the feed fails', () => {
  const task = byCover('login-wall');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), null, null)]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: a deadline quote from the first page fails when the date is only on a second page', () => {
  const task = byCover('second-page-deadline');
  const title = task.expected.required[0]!.title;
  const listing = Object.keys(task.pages).find((u) => !u.includes('/apply'));
  const apply = Object.keys(task.pages).find((u) => u.includes('/apply'));
  assert.ok(listing && apply);
  const quote = 'Applications close on December 18, 2026 at 11:59 pm Pacific.';
  const wrong = scoreTask(task, [card(title, listing, '2026-12-18T23:59:00-08:00', quote)]);
  assert.equal(wrong.pass, false);
  assert.ok(wrong.reasons.some((r) => r.startsWith('deadline quote not supported:')));
  const right = scoreTask(task, [card(title, apply, '2026-12-18T23:59:00-08:00', quote)]);
  assert.equal(right.pass, true);
});

test('score: a quote that is not on the page fails', () => {
  const task = byCover('quote-not-on-page');
  const title = task.expected.required[0]!.title;
  const result = scoreTask(task, [
    card(title, urlOf(task), '2027-01-09T12:00:00-05:00', 'This sentence is nowhere on the Ironbark Analytics posting page at all.'),
  ]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('deadline quote not supported:')));
});

test('score: a posting a note rules out fails', () => {
  const task = byCover('note-rules-out');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), '2026-12-20T23:59:00-08:00', 'Applications close on December 20, 2026 at 11:59 pm Pacific.')]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: a class year the posting does not allow fails', () => {
  const task = byCover('class-year');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), '2027-01-12T23:59:00-08:00', 'Applications close on January 12, 2027 at 11:59 pm Pacific.')]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: a past deadline in the feed fails', () => {
  const task = byCover('past-deadline');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), '2026-11-10T12:00:00-08:00', 'Applications closed on November 10, 2026 at noon Pacific.')]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: omitting a remote role fails', () => {
  const task = byCover('remote-role');
  const omitted = scoreTask(task, []);
  assert.equal(omitted.pass, false);
  assert.ok(omitted.reasons.some((r) => r.startsWith('missing required title:')));
  const kept = scoreTask(task, [
    card(task.expected.required[0]!.title, urlOf(task), '2026-12-20T23:59:00-08:00', 'Applications close on December 20, 2026 at 11:59 pm Pacific.'),
  ]);
  assert.equal(kept.pass, true);
});

test('score: an in-person role too far away fails', () => {
  const task = byCover('too-far');
  const result = scoreTask(task, [card(task.expected.forbidden[0]!, urlOf(task), '2027-01-15T23:59:00-05:00', 'Applications close on January 15, 2027 at 11:59 pm Eastern.')]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('forbidden title present:')));
});

test('score: two cards for the same posting at two urls fail', () => {
  const task = byCover('duplicate-urls');
  const title = task.expected.required[0]!.title;
  const quote = 'Applications close on December 12, 2026 at 11:59 pm Pacific.';
  const official = urlOf(task, 'copperfinch.example');
  const board = urlOf(task, 'boards.example');
  const both = scoreTask(task, [
    card(title, official, '2026-12-12T23:59:00-08:00', quote),
    card(title, board, '2026-12-12T23:59:00-08:00', quote),
  ]);
  assert.equal(both.pass, false);
  assert.ok(both.reasons.some((r) => r.startsWith('same posting kept at two urls:')));
  const one = scoreTask(task, [card(title, official, '2026-12-12T23:59:00-08:00', quote)]);
  assert.equal(one.pass, true);
});

test('score: a required deadline with no quote fails', () => {
  const task = byCover('pass');
  const result = scoreTask(task, [card(task.expected.required[0]!.title, urlOf(task), '2026-12-18T23:59:00-08:00', null)]);
  assert.equal(result.pass, false);
  assert.ok(result.reasons.some((r) => r.startsWith('deadline quote missing:')));
});

test('fixtures: all 20 tasks load and name a fixture that exists', () => {
  assert.equal(TASKS.length, 20);
  const covers = new Set(TASKS.map((t) => t.covers));
  for (const needed of [
    'pass',
    'closed-posting',
    'login-wall',
    'second-page-deadline',
    'quote-not-on-page',
    'note-rules-out',
    'class-year',
    'past-deadline',
    'remote-role',
    'too-far',
    'duplicate-urls',
  ]) {
    assert.ok(covers.has(needed), needed);
  }
  for (const task of TASKS) {
    const files = Object.values(
      (JSON.parse(readFileSync(join(DIR, `${task.id}.json`), 'utf8')) as AgentTaskSource).pages,
    );
    assert.ok(files.length >= 1, task.id);
    for (const file of files) assert.ok(readdirSync(DIR).includes(file), `${task.id} names ${file}`);
    for (const html of Object.values(task.pages)) {
      assert.ok(html.length > 0, task.id);
      assert.match(html, /<html/i);
      assert.ok(!html.includes('fetch('));
    }
  }
});
