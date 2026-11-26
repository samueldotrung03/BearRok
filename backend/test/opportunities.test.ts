// The shared opportunities table: one row per posting whichever student found it, with nothing
// about any one student in it, and filters that a feed for many students needs.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Hono } from 'hono';
import type { Opportunity, StudentMemory } from '../src/agents/types.ts';
import { openEmbedded } from '../src/opportunities/db.ts';
import { feedCatalog, mountOpportunities, OpportunityCatalog } from '../src/opportunities/index.ts';

const posting = (over: Partial<Opportunity> = {}): Opportunity => ({
  id: 'opp-1',
  origin: 'live',
  type: 'internship',
  title: 'Software Engineering Intern',
  organizer: 'Example Robotics',
  sourceUrl: 'https://www.example.com/jobs/swe-intern',
  actionUrl: null,
  format: 'in_person',
  location: 'Berkeley, CA',
  field: 'Software',
  tags: ['backend', 'robotics'],
  eligibility: null,
  eligibleYears: null,
  deadline: '2027-01-15',
  startTime: null,
  image: null,
  evidence: [],
  fitExplanation: 'Fits what this one student asked for',
  unknowns: [],
  foundAt: '2026-11-20T10:00:00.000Z',
  lastCheckedAt: '2026-11-20T10:00:00.000Z',
  baseScore: 0.9,
  foundBy: 'Internship manager',
  alsoSeenAt: [],
  application: null,
  ...over,
});

let catalog: OpportunityCatalog;
before(async () => {
  catalog = await OpportunityCatalog.open(await openEmbedded(null));
});
after(() => catalog.close());

test('the same posting found for two students is one row, without either student in it', async () => {
  await catalog.upsert([posting()]);
  // The second student's copy carries tracking on the link and their own fit.
  await catalog.upsert([posting({ sourceUrl: 'https://example.com/jobs/swe-intern/?utm_source=x', fitExplanation: 'Another student', baseScore: 0.4 })]);
  const { total, opportunities } = await catalog.list();
  assert.equal(total, 1);
  const stored = opportunities[0]!;
  assert.equal(stored.title, 'Software Engineering Intern');
  for (const field of ['fitExplanation', 'baseScore', 'match', 'foundBy', 'unknowns']) assert.ok(!(field in stored), `${field} is one student's, not the posting's`);
  assert.equal((await catalog.byUrl('https://example.com/jobs/swe-intern?ref=feed'))?.id, 'opp-1');
});

test('a newer check replaces the row and an older copy does not', async () => {
  await catalog.upsert([posting({ deadline: '2027-02-01', lastCheckedAt: '2026-11-22T10:00:00.000Z' })]);
  assert.equal((await catalog.byUrl(posting().sourceUrl))?.deadline, '2027-02-01');
  await catalog.upsert([posting({ deadline: '2027-01-15', lastCheckedAt: '2026-11-21T10:00:00.000Z' })]);
  assert.equal((await catalog.byUrl(posting().sourceUrl))?.deadline, '2027-02-01');
});

test('filters by kind, words and deadline, soonest deadline first; samples only when asked for', async () => {
  await catalog.upsert([
    posting({ id: 'opp-2', type: 'hackathon', title: 'Winter Hackathon', organizer: 'Cal Hacks', sourceUrl: 'https://hack.example.org/winter', tags: ['ai'], deadline: '2026-12-10' }),
    posting({ id: 'opp-3', type: 'research', title: 'Summer Research Program', organizer: 'A Lab', sourceUrl: 'https://lab.example.edu/summer', tags: [], deadline: null }),
    posting({ id: 'opp-4', origin: 'prepared', title: 'Invented Sample Internship', sourceUrl: 'https://sample.example.com/a' }),
  ]);
  const titles = async (q: Parameters<OpportunityCatalog['list']>[0]) => (await catalog.list(q)).opportunities.map((o) => o.id);
  // No known deadline sorts last; the sample is left out.
  assert.deepEqual(await titles({}), ['opp-2', 'opp-1', 'opp-3']);
  assert.deepEqual(await titles({ type: 'hackathon' }), ['opp-2']);
  assert.deepEqual(await titles({ q: 'robotics' }), ['opp-1']);
  assert.deepEqual(await titles({ deadlineTo: '2026-12-31' }), ['opp-2']);
  assert.deepEqual(await titles({ deadlineFrom: '2027-01-01' }), ['opp-1']);
  assert.deepEqual(await titles({ origin: 'prepared' }), ['opp-4']);
  assert.equal((await catalog.list({ limit: 1 })).total, 3);
  assert.deepEqual(await catalog.counts(), { live: 3, prepared: 1, byType: { internship: 1, hackathon: 1, research: 1 } });
});

test('the link, the apply link and the description are stored, and the description is searchable', async () => {
  await catalog.upsert([posting({ id: 'opp-8', sourceUrl: 'https://Fellow.example.org/apply?utm_source=x', actionUrl: 'https://forms.example.org/f1', title: 'Policy Fellowship', organizer: 'A Foundation', tags: [], field: null, location: null, deadline: null, description: 'Fellows write briefings on semiconductor supply chains.' })]);
  const stored = (await catalog.list({ q: 'semiconductor' })).opportunities;
  assert.deepEqual(stored.map((o) => [o.id, o.sourceUrl, o.actionUrl, o.description]), [['opp-8', 'https://Fellow.example.org/apply?utm_source=x', 'https://forms.example.org/f1', 'Fellows write briefings on semiconductor supply chains.']]);
});

test('a deadline that is not a date, and a posting with no usable link, do not break a write', async () => {
  const wrote = await catalog.upsert([
    posting({ id: 'opp-5', sourceUrl: 'https://rolling.example.com/apply', deadline: 'rolling' }),
    posting({ id: 'opp-6', sourceUrl: 'not a link' }),
  ]);
  assert.equal(wrote, 1);
  assert.equal((await catalog.byUrl('https://rolling.example.com/apply'))?.deadline, 'rolling');
});

test('saving a student memory puts its postings in the table, and a failing table does not fail the save', async () => {
  const saved: string[] = [];
  const memory = { loadStudent: async () => null, deleteStudent: async () => {}, saveStudent: async (id: string) => void saved.push(id) };
  const student = { learned: { opportunities: [posting({ id: 'opp-7', sourceUrl: 'https://club.example.org/join', type: 'club', title: 'Robotics Club' })] } } as unknown as StudentMemory;
  await feedCatalog(memory, catalog).saveStudent('s1', student);
  for (let i = 0; i < 50 && !(await catalog.byUrl('https://club.example.org/join')); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal((await catalog.byUrl('https://club.example.org/join'))?.title, 'Robotics Club');

  const reports: string[] = [];
  const broken = { upsert: async () => Promise.reject(new Error('database is down')) } as unknown as OpportunityCatalog;
  const feeding = feedCatalog(memory, broken, (m) => reports.push(m));
  await feeding.saveStudent('s2', student);
  await feeding.saveStudent('s2', student);
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(saved, ['s1', 's2', 's2']);
  assert.equal(reports.length, 1, 'reported once, not on every save');
});

test('GET /api/opportunities answers with the filters applied', async () => {
  const app = new Hono();
  mountOpportunities(app, catalog);
  const res = await app.request('/api/opportunities?type=hackathon&deadlineTo=2026-12-31&limit=5');
  assert.equal(res.status, 200);
  const body = (await res.json()) as { total: number; opportunities: { id: string }[] };
  assert.deepEqual([body.total, body.opportunities.map((o) => o.id)], [1, ['opp-2']]);
  const counts = (await (await app.request('/api/opportunities/counts')).json()) as { live: number };
  assert.equal(counts.live, 6);
});
