// Simulated career discovery: the same agent calls as Grok, answered offline with example content
// written around the career's name. Every part it writes is marked as a sample on the page, so a
// student never mistakes it for research. It lets the whole flow (plan, four parts, validators,
// summary, "Add more", suggestions) run with no network.
//
// CAREER_SIM_STEP_MS sets how long each call takes (default 1200 ms; researchers take twice that),
// so the page's per-part progress can be watched. CAREER_SIM_FAULTS makes chosen calls fail the way
// Grok fails, to see the page's failed states offline: a comma list of `<call>:<fault>[:<times>]`,
// where call is the agent call without "career_" (plan, basics, voices, interview, start,
// review_basics, ...), fault is timeout, parse or 402, and times (default 2: the first try and its
// retry) is how many calls fail before it answers again. Example: CAREER_SIM_FAULTS=interview:timeout
import { z } from 'zod';
import { config } from '../config.ts';
import { BalanceExhaustedError } from '../quota.ts';
import type { Ask } from './guide.ts';

type Fault = 'timeout' | 'parse' | '402';

/** Parses CAREER_SIM_FAULTS. Unknown entries are ignored. */
export function parseFaults(raw: string | undefined): Map<string, { fault: Fault; left: number }> {
  const out = new Map<string, { fault: Fault; left: number }>();
  for (const entry of (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [call, fault, times] = entry.split(':');
    if (!call || !(fault === 'timeout' || fault === 'parse' || fault === '402')) continue;
    out.set(call, { fault, left: Math.max(1, Number(times) || 2) });
  }
  return out;
}

const careerOf = (user: string) => /^Career: (.+)$/m.exec(user)?.[1]?.trim() ?? /The student typed: "(.+)"/.exec(user)?.[1]?.trim() ?? 'this career';

const title = (typed: string) =>
  typed
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ');

/** Example answers for each call, written around the career's name. */
export function simulatedAnswer(name: string, user: string): unknown {
  const career = careerOf(user);
  const c = career.toLowerCase();
  const site = (path: string) => `https://example.org/simulated/${path}`;
  switch (name) {
    case 'career_plan': {
      const t = title(career);
      return {
        title: t,
        oneLine: `A simulated outline of what ${t.toLowerCase()} work involves.`,
        field: c.split(/\s+/)[0] ?? 'general',
        angles: {
          basics: `The core methods, tools and knowledge ${t} work runs on.`,
          voices: `People early and mid-way through a ${t} career.`,
          interview: `How ${t} roles screen and assess candidates.`,
          start: `First steps a student with no experience can take toward ${t}.`,
        },
      };
    }
    case 'career_basics':
      return {
        summary: `Simulated example: people in ${c} turn a field's methods into everyday work for a team or client.`,
        dayInLife: ['Review what changed since yesterday', 'Work on the main project of the week', 'Check results with a teammate'],
        whatTheyDo: ['Plan and carry out the core work', 'Explain results to people outside the field'],
        whereTheyWork: ['Companies of every size', 'Public agencies', 'Consultancies'],
        specialties: [{ name: `Applied ${c}`, what: 'Putting the methods to work on real problems' }],
        skills: [
          { name: 'Spreadsheets', kind: 'tool' },
          { name: 'Structured problem solving', kind: 'method' },
          { name: `Foundations of ${c}`, kind: 'knowledge' },
        ],
        education: 'Simulated: a bachelor’s degree in a related field is common.',
        pay: null,
        outlook: null,
        sources: [{ title: 'Simulated source', url: site('basics') }],
      };
    case 'career_voices':
    case 'career_voices_sample':
      return {
        posts: [
          { author: 'Sample person A', role: `Early-career ${c} professional`, handle: null, text: `Simulated story: the first year in ${c} was mostly learning how the team works.`, takeaway: 'Ask questions early.', topic: 'the work', url: null, date: null },
          { author: 'Sample person B', role: `Senior ${c} professional`, handle: null, text: 'Simulated story: projects you can show mattered more than grades when I hired.', takeaway: 'Build something you can show.', topic: 'getting in', url: null, date: null },
        ],
      };
    case 'career_interview':
      return {
        formats: [
          { name: 'Résumé screen', tests: 'Whether your experience fits the role', howToPractice: 'Tailor one page to each posting', url: null },
          { name: 'Technical interview', tests: `Core ${c} knowledge`, howToPractice: 'Explain a past project out loud', url: null },
        ],
        questions: [
          { kind: 'Résumé screen', question: `Why ${c}?`, tip: 'Name one moment that drew you to it.' },
          { kind: 'Technical interview', question: 'Walk me through a project you are proud of.', tip: 'Say what you did, not only the team.' },
        ],
        sources: [{ title: 'Simulated source', url: site('interview') }],
      };
    case 'career_start': {
      const formats = [...user.matchAll(/^- (.+)$/gm)].map((m) => m[1]!.trim());
      return {
        steps: [
          { title: `Take an introductory ${c} course`, detail: 'Learn the vocabulary and the main methods.', when: 'First semester', resource: null, prepares: formats.slice(1, 2) },
          { title: 'Write a one-page résumé', detail: 'List coursework, projects and any work.', when: 'Before applying', resource: null, prepares: formats.slice(0, 1) },
        ],
        resources: [{ title: 'Simulated course', url: site('start'), kind: 'course', free: true }],
      };
    }
    case 'career_voices_summary':
      return { summary: 'In these sample stories the work is mostly learning on the job. They advise building something you can show.' };
    case 'career_ask':
      return { route: 'career-discovery', focus: 'More examples for this part.', reply: 'Simulated agents will add a few more example items.' };
    case 'career_suggest':
      return { prompts: ['More for someone in their first year', 'What changes in a small company', 'Free ways to practise'] };
  }
  if (name.startsWith('career_review_')) {
    const found = user.split('WROTE IT:\n')[1];
    return { data: found ? JSON.parse(found) : null, removed: [] };
  }
  throw new Error(`The simulated agents have no answer for ${name}.`);
}

/** The simulated model, with optional delay and faults. */
export function simulatedAsk(opts: { stepMs?: number; faults?: string } = {}): Ask {
  const stepMs = opts.stepMs ?? Number(process.env.CAREER_SIM_STEP_MS ?? 1200);
  const faults = parseFaults(opts.faults ?? process.env.CAREER_SIM_FAULTS);
  return (async (call) => {
    await new Promise((r) => setTimeout(r, call.name.startsWith('career_review_') || !call.tools?.length ? stepMs : stepMs * 2));
    const f = faults.get(call.name.replace(/^career_/, ''));
    if (f && f.left > 0) {
      f.left--;
      if (f.fault === '402') throw new BalanceExhaustedError();
      if (f.fault === 'timeout') throw new Error(`grok CLI timed out after ${Math.round(config.grokCli.timeoutMs / 1000)}s`);
      throw new Error('the reply contained no JSON object');
    }
    const data = (call.schema as z.ZodType).parse(simulatedAnswer(call.name, call.user));
    return { data };
  }) as Ask;
}
