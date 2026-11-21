import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { test } from 'node:test';
import { SimBrain } from '../src/agents/simBrain.ts';
import { AgentSystem } from '../src/agents/system.ts';
import { createApp } from '../src/app.ts';
import { readResume } from '../src/resume.ts';
import { emptyResume, extractResumeProfile, normalizeResume, ResumeProfileSchema, simulateResume, type ResumeProfile } from '../src/resumeExtract.ts';
import { LocalStore } from '../src/store/local.ts';

const SAMPLE = `Name: Jordan Hale
Email: jordan.hale@example.edu
Phone: (510) 555-0148
School: UC Berkeley
Major: Computer Science
Class year: Junior
Graduation: May 2028
GPA: 3.72
Location: Berkeley, CA
About: Builds small tools for student clubs.
Skills: Python, React, SQL
Interests: compilers, student communities
Target roles: Software engineering intern
Career interests: Software engineering
LinkedIn: linkedin.com/in/jordan-hale
GitHub: github.com/jordanhale
Portfolio: jordanhale.example

Experience
Software engineering intern — Northwind Labs
Berkeley, CA · Jun 2025 – Aug 2025
Built a ledger service the finance team still uses.
Skills: Python, SQL

Projects
Campus Eats — Personal project
Sep 2024 – Dec 2024
A meal planner for the dorm, used by 40 students.
Skills: React
Link: https://github.com/jordanhale/campus-eats
`;

const filled = (): ResumeProfile => {
  const base = emptyResume();
  base.fullName = { found: true, value: 'Jordan Hale', confidence: 1 };
  return base;
};

test('schema: a confidence outside 0 to 1, or a fact with the wrong types, is rejected', () => {
  const ok = filled();
  assert.equal(ResumeProfileSchema.parse(ok).fullName.value, 'Jordan Hale');
  assert.throws(() => ResumeProfileSchema.parse({ ...ok, gpa: { found: true, value: '3.7', confidence: 4 } }));
  assert.throws(() => ResumeProfileSchema.parse({ ...ok, fullName: { found: 'yes', value: 'A', confidence: 1 } }));
  assert.throws(() => ResumeProfileSchema.parse({ ...ok, skills: { found: true, value: 'Python', confidence: 1 } }));
  const { fullName: _dropped, ...missing } = ok;
  assert.throws(() => ResumeProfileSchema.parse(missing));
});

test('normalize: a fact marked not found is cleared, and a value that is not that fact is dropped', () => {
  const raw = filled();
  raw.email = { found: false, value: 'guess@example.edu', confidence: 0.9 };
  raw.phone = { found: true, value: 'call me maybe', confidence: 0.8 };
  raw.year = { found: true, value: 'junior', confidence: 1 };
  raw.gpa = { found: true, value: '3.72/4.00', confidence: 0.9 };
  raw.graduation = { found: true, value: 'soon', confidence: 0.5 };
  raw.skills = { found: true, value: [' Python ', '', 'python', 'SQL'], confidence: 0 };
  raw.experience = {
    found: true,
    confidence: 1,
    value: [{ kind: 'intern', role: 'Helper', organization: '', location: '', start: 'Jun 2025', end: '', current: false, summary: '', skills: [], link: 'not a link', confidence: 0 }],
  };
  const out = normalizeResume(raw);
  assert.deepEqual(out.email, { found: false, value: null, confidence: 0 });
  assert.equal(out.phone.found, false);
  assert.equal(out.year.value, 'Junior');
  assert.equal(out.gpa.value, '3.72');
  assert.equal(out.graduation.found, false);
  assert.deepEqual(out.skills.value, ['Python', 'SQL']);
  assert.equal(out.skills.confidence, 0.5);
  assert.equal(out.experience.value[0]?.kind, 'Internship');
  assert.equal(out.experience.value[0]?.start, '2025-06');
  assert.equal(out.experience.value[0]?.link, '');
  assert.equal(out.experience.value[0]?.confidence, 0.5);
});

test('simulated reader: a labeled résumé fills every stated field and leaves the rest empty', () => {
  const { extraction, provider } = { extraction: simulateResume(SAMPLE), provider: 'simulated' as const };
  assert.equal(provider, 'simulated');
  assert.equal(extraction.fullName.value, 'Jordan Hale');
  assert.equal(extraction.fullName.confidence, 0.95);
  assert.equal(extraction.email.value, 'jordan.hale@example.edu');
  assert.equal(extraction.phone.value, '(510) 555-0148');
  assert.equal(extraction.school.value, 'UC Berkeley');
  assert.equal(extraction.major.value, 'Computer Science');
  assert.equal(extraction.year.value, 'Junior');
  assert.equal(extraction.graduation.value, 'May 2028');
  assert.equal(extraction.gpa.value, '3.72');
  assert.equal(extraction.location.value, 'Berkeley, CA');
  assert.equal(extraction.about.value, 'Builds small tools for student clubs.');
  assert.deepEqual(extraction.skills.value, ['Python', 'React', 'SQL']);
  assert.deepEqual(extraction.interests.value, ['compilers', 'student communities']);
  assert.deepEqual(extraction.targetRoles.value, ['Software engineering intern']);
  assert.deepEqual(extraction.careerInterests.value, ['Software engineering']);
  assert.equal(extraction.linkedin.value, 'linkedin.com/in/jordan-hale');
  assert.deepEqual(extraction.links.value, ['github.com/jordanhale', 'jordanhale.example']);
  assert.equal(extraction.experience.value.length, 1);
  const job = extraction.experience.value[0]!;
  assert.equal(job.kind, 'Internship');
  assert.equal(job.role, 'Software engineering intern');
  assert.equal(job.organization, 'Northwind Labs');
  assert.equal(job.location, 'Berkeley, CA');
  assert.equal(job.start, '2025-06');
  assert.equal(job.end, '2025-08');
  assert.equal(job.current, false);
  assert.match(job.summary, /ledger service/);
  assert.deepEqual(job.skills, ['Python', 'SQL']);
  const project = extraction.projects.value[0]!;
  assert.equal(project.kind, 'Project');
  assert.equal(project.role, 'Campus Eats');
  assert.equal(project.start, '2024-09');
  assert.equal(project.end, '2024-12');
  assert.equal(project.link, 'https://github.com/jordanhale/campus-eats');
  assert.deepEqual(simulateResume(SAMPLE), extraction);
});

test('simulated reader: does not guess a class year, an email buried in a job, or a name that is not a name', () => {
  const dated = simulateResume('Graduation: May 2028\n\nExperience\nIntern — Northwind Labs\nAsked people to email jordan.hale@example.edu about the scanner.\n');
  assert.equal(dated.year.found, false);
  assert.equal(dated.email.found, false);
  assert.equal(dated.graduation.value, 'May 2028');
  assert.equal(dated.experience.value[0]?.role, 'Intern');
  assert.match(dated.experience.value[0]?.summary ?? '', /jordan\.hale@example\.edu/);

  const prose = simulateResume('Built a network scanner in Python.\n');
  assert.equal(prose.fullName.found, false);
  assert.equal(prose.skills.found, false);
  assert.equal(prose.school.found, false);
  assert.equal(prose.experience.found, false);

  const header = simulateResume('Jordan Hale\njordan.hale@example.edu\n');
  assert.equal(header.fullName.value, 'Jordan Hale');
  assert.ok(header.fullName.confidence < 0.75);
  assert.equal(header.email.value, 'jordan.hale@example.edu');
  assert.equal(header.school.found, false);
  assert.equal(header.year.found, false);
});

test('live reader: Grok is asked not to guess, and a not-found value is still dropped', async () => {
  let seen = '';
  const model = filled();
  model.email = { found: false, value: 'guess@example.edu', confidence: 1 };
  model.school = { found: true, value: 'UC Berkeley', confidence: 0.4 };
  const result = await extractResumeProfile('the résumé text', {
    live: true,
    ask: async (opts) => {
      seen = `${opts.system}\n${opts.user}`;
      assert.equal(opts.name, 'resume_profile');
      return { data: ResumeProfileSchema.parse(model), citations: [] };
    },
  });
  assert.equal(result.provider, 'grok');
  assert.match(seen, /Do not guess/);
  assert.match(seen, /the résumé text/);
  assert.equal(result.extraction.email.found, false);
  assert.equal(result.extraction.email.value, null);
  assert.equal(result.extraction.school.value, 'UC Berkeley');
  assert.equal(result.extraction.school.confidence, 0.4);

  let called = false;
  const offline = await extractResumeProfile(SAMPLE, { live: false, ask: async () => { called = true; throw new Error('Grok should not be called'); } });
  assert.equal(called, false);
  assert.equal(offline.provider, 'simulated');
  assert.equal(offline.extraction.fullName.value, 'Jordan Hale');
});

function crc32(data: Buffer): number {
  let c = ~0;
  for (const byte of data) {
    c ^= byte;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return ~c >>> 0;
}

/** A tiny .docx: one stored or deflated ZIP entry plus the central directory. */
function docx(xml: string, method: 0 | 8): Uint8Array {
  const name = Buffer.from('word/document.xml');
  const raw = Buffer.from(xml);
  const data = method === 8 ? deflateRawSync(raw) : raw;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(crc32(raw), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc32(raw), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(local.length + name.length + data.length, 16);
  return new Uint8Array(Buffer.concat([local, name, data, central, name, eocd]));
}

test('docx: text is read out of a Word résumé, stored or deflated', async () => {
  const xml = '<w:document><w:p><w:r><w:t>Jordan Hale</w:t></w:r></w:p><w:p><w:r><w:t>Python &amp; SQL</w:t></w:r></w:p></w:document>';
  assert.equal(await readResume(docx(xml, 0), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'Jordan Hale\nPython & SQL');
  assert.equal(await readResume(docx(xml, 8), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'Jordan Hale\nPython & SQL');
  assert.equal(await readResume(new Uint8Array([1, 2, 3]), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null);
});

test('extract route: simulated read after upload, and the failure cases', async () => {
  const made: AgentSystem[] = [];
  const { app } = createApp(new LocalStore(null), {}, {
    demo: new AgentSystem(new SimBrain({ speed: 0 }), {}),
    webConfig: { apiKey: 'k', projectId: 'p' },
    verify: async (token) => (token === 'ok' ? { uid: 'u1', name: 'Ana', email: null, picture: null, provider: 'google', emailVerified: true } : Promise.reject(new Error('bad'))),
    forUser: () => {
      const system = new AgentSystem(new SimBrain({ speed: 0 }), {});
      made.push(system);
      return system;
    },
  });
  const auth = { authorization: 'Bearer ok' };
  const extract = () => app.request('/api/students/me/resume/extract', { method: 'POST', headers: auth });

  assert.equal((await app.request('/api/students/me/resume/extract', { method: 'POST' })).status, 401);
  assert.equal((await extract()).status, 404);

  const upload = (body: string, type: string) =>
    app.request('/api/students/me/resume', { method: 'PUT', headers: { ...auth, 'content-type': type, 'x-file-name': 'resume.txt' }, body });
  assert.equal((await upload('not a pdf', 'application/pdf')).status, 200);
  const unreadable = await extract();
  assert.equal(unreadable.status, 422);
  assert.match((await unreadable.json() as { error: string }).error, /No text could be read/);

  assert.equal((await upload(SAMPLE, 'text/plain')).status, 200);
  const res = await extract();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { provider: string; extraction: ResumeProfile };
  assert.equal(body.provider, 'simulated');
  assert.equal(body.extraction.fullName.value, 'Jordan Hale');
  assert.equal(body.extraction.year.value, 'Junior');
  assert.equal(made[0]!.getResume()?.text?.includes('Jordan Hale'), true);
  // The profile itself is untouched until the student confirms.
  assert.notEqual(made[0]!.student().profile.name, 'Jordan');
});

test('extract route: a failed read is an error the page can retry', async () => {
  const { app } = createApp(new LocalStore(null), {}, {
    demo: new AgentSystem(new SimBrain({ speed: 0 }), {}),
    webConfig: { apiKey: 'k', projectId: 'p' },
    verify: async () => ({ uid: 'u1', name: 'Ana', email: null, picture: null, provider: 'google', emailVerified: true }),
    forUser: () => new AgentSystem(new SimBrain({ speed: 0 }), {}),
    extractResume: async () => { throw new Error('grok down'); },
  });
  const auth = { authorization: 'Bearer ok' };
  await app.request('/api/students/me/resume', { method: 'PUT', headers: { ...auth, 'content-type': 'text/plain' }, body: 'Name: Ana' });
  const res = await app.request('/api/students/me/resume/extract', { method: 'POST', headers: auth });
  assert.equal(res.status, 502);
  assert.match((await res.json() as { error: string }).error, /Try again/);
});

test('sign-in off: the local demo student can upload and extract; sign-in on still refuses that student', async () => {
  const off = createApp(new LocalStore(null), {}, {
    demo: new AgentSystem(new SimBrain({ speed: 0 }), {}),
  }).app;
  const upload = (app: typeof off, path: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'PUT', headers: { 'content-type': 'text/plain', 'x-file-name': 'resume.txt', ...headers }, body: SAMPLE });

  assert.equal((await upload(off, '/api/students/demo/resume')).status, 200);
  const extracted = await off.request('/api/students/demo/resume/extract', { method: 'POST' });
  assert.equal(extracted.status, 200);
  const body = (await extracted.json()) as { provider: string; extraction: ResumeProfile };
  assert.equal(body.provider, 'simulated');
  assert.equal(body.extraction.fullName.value, 'Jordan Hale');
  const state = (await (await off.request('/api/students/demo/state')).json()) as { student: { profile: { name: string }; resume: { readable: boolean } | null } };
  assert.equal(state.student.resume?.readable, true);
  assert.notEqual(state.student.profile.name, 'Jordan');
  // /me still requires a configured sign-in. The local path is the demo student, not an open /me.
  assert.equal((await upload(off, '/api/students/me/resume')).status, 503);

  const on = createApp(new LocalStore(null), {}, {
    demo: new AgentSystem(new SimBrain({ speed: 0 }), {}),
    webConfig: { apiKey: 'k', projectId: 'p' },
    verify: async () => ({ uid: 'u1', name: 'Ana', email: null, picture: null, provider: 'google', emailVerified: true }),
    forUser: () => new AgentSystem(new SimBrain({ speed: 0 }), {}),
  }).app;
  assert.equal((await upload(on, '/api/students/demo/resume')).status, 403);
  assert.equal((await on.request('/api/students/demo/resume/extract', { method: 'POST' })).status, 403);
  assert.equal((await on.request('/api/students/me/resume/extract', { method: 'POST' })).status, 401);
});
