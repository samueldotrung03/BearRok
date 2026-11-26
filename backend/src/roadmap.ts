// The roadmap writer: one search for how people get into the path, then one fill of the roadmap
// schema with no tools. A draft thinner than fullEnough is asked for again, still with no tools.
// The dashboard draws whatever this returns. One finished answer is cached per distinct request.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.ts';
import { tierModels } from './harness.ts';
import { grokJson, type GrokResult } from './grok.ts';

const text = (max: number) => z.string().trim().max(max);
const list = (max: number, each = 120) => z.array(text(each)).max(max).default([]);

/** What the dashboard sends. Everything in it is the student's own data or the posting's. */
export const RoadmapRequest = z.object({
  kind: z.enum(['career', 'job']),
  /** The career, or "Role at Organizer". */
  goal: text(200).min(1),
  profile: z.object({
    major: text(120).default(''),
    year: text(40).default(''),
    school: text(120).default(''),
    about: text(600).default(''),
    skills: list(40),
    interests: list(20),
    experience: z.array(z.object({ role: text(120), organization: text(120).default(''), summary: text(400).default(''), skills: list(15) })).max(12).default([]),
    /** Custom notes from the profile page. They outrank everything else. */
    notes: list(12, 400),
    restrictions: list(12, 200),
  }),
  posting: z
    .object({
      title: text(200),
      organizer: text(120),
      type: text(40),
      description: text(1500).default(''),
      tags: list(20),
      location: text(120).nullable().default(null),
      deadline: text(40).nullable().default(null),
      materials: list(12, 200),
      prompts: list(12, 400),
      sourceUrl: text(400).default(''),
      /** Where the student's application stands. */
      status: z.enum(['suggested', 'interested', 'to_apply', 'applying', 'applied']),
    })
    .nullable()
    .default(null),
  /** Paths of people who reached the goal that the app already holds, as short timelines. */
  chosen: z
    .array(z.object({ category: z.string().max(120), title: z.string().max(200) }))
    .max(60)
    .default([])
    .describe('Career only: the options the student picked from the board. When given, the roadmap is built from these.'),
  knownPaths: z.array(z.object({ outcome: text(200), timeline: list(8, 200) })).max(12).default([]),
  /** Text of the student's résumé. Filled in by the server from the uploaded file, never by the browser. */
  resume: text(6000).default(''),
  /** Steps the student already finished, so they are not suggested again. */
  done: list(30, 200),
  /** Recommendations the student said are not for them. */
  setAside: list(30, 200),
});
export type RoadmapRequest = z.infer<typeof RoadmapRequest>;

export const Roadmap = z.object({
  summary: z.string().describe('Two sentences to the student: where they stand against this goal and what the roadmap focuses on.'),
  fit: z.object({
    score: z.number().min(0).max(100).describe('How much of what the goal asks for the profile already shows, 0 to 100.'),
    met: z.array(z.string()).describe('Qualifications the profile or experience already shows, in a few words each.'),
    missing: z.array(z.string()).describe('Qualifications asked for that nothing on the profile shows yet.'),
  }),
  phases: z
    .array(
      z.object({
        title: z.string().describe('Two to four words.'),
        more: z.array(z.object({ title: z.string(), why: z.string() })).default([]).describe('For a roadmap built from the student\'s picks: further recommendations in this category that they have not chosen. Empty otherwise.'),
        window: z.string().describe('When, in words, such as "This week" or "Before the deadline". Empty if unknown.'),
        steps: z.array(
          z.object({
            title: z.string().describe('An action, under ten words.'),
            detail: z.string().describe('One or two sentences on exactly what to do, for this student.'),
            kind: z.enum(['learn', 'build', 'join', 'attend', 'apply']),
            actions: z.array(z.string()).default([]).describe('For a roadmap built from the student\'s picks: three to five concrete things to do for this step, in order, each one short sentence. Empty otherwise.'),
            source: z.enum(['people', 'posting', 'gap', 'after']).describe('people: what people who got in did. posting: the posting asks for it. gap: closes something the profile lacks. after: for after the application is sent.'),
            hours: z.number().min(0.25).max(200).describe('A rough planning estimate.'),
            skills: z.array(z.string()).describe('Skills this step builds. Empty if none.'),
            strength: z.string().nullable().describe('For source "people" only: how common it was, such as "Most people did this". Null when there is no evidence.'),
            why: z.string().describe('One sentence on why this is on this student\'s roadmap, naming what it rests on.'),
            resources: z.array(z.object({ label: z.string(), url: z.string() })).describe('Real courses or free resources found by search, with their links. Empty if none was found; never make one up.'),
          }),
        ),
      }),
    )
    .min(1),
  howPeopleGotIn: z.array(z.object({ outcome: z.string(), timeline: z.array(z.string()) })).describe('Short accounts of how people got this role or one like it, from search or from the paths given. No names.'),
  process: z
    .array(z.object({ stage: z.string().describe('A stage of the organizer\'s selection process, two to five words.'), detail: z.string().describe('What happens in it and how to prepare, from what you found. One or two sentences.') }))
    .default([])
    .describe('For a posting only: the stages of this organizer\'s process in order, as far as sources show. Empty when you found nothing; never guess the stages.'),
  relatedPaths: z
    .array(z.object({ title: z.string().describe('A career path, two to four words.'), why: z.string().describe('One sentence on how it connects to this goal and to what this student already has.') }))
    .default([])
    .describe('For a career only: three to five neighbouring paths the student may not have considered. Empty for a posting.'),
});
export type Roadmap = z.infer<typeof Roadmap>;

const SYSTEM = `You write one student's roadmap for BearRok, a student opportunities app.

Rules, in order:
1. The student's notes come first and their restrictions are rules. Never suggest something a note or restriction rules out.
2. Write for this student only. Compare what the goal asks for with what their profile and experience actually show. Do not repeat what they have already done, and do not bring back what they set aside.
3. No guessed facts. A date, deadline, acceptance rate, pay figure or requirement with no source behind it is left out or called unknown. Resources must be real pages from the urls given; give none rather than invent one.
4. Ground "how people got in" in the notes and urls given and in the paths given. Say what people did, not who they were. If you found little, return little.
5. A career roadmap is open-ended, never a fixed sequence. Act as an advisor laying out options, not a checklist: each phase is a direction the student could take (for example skills to build, projects, communities, experiences, opportunities to go for), its window is empty, and each step in it is one option with why it might be valuable for this student in particular. Offer real variety, including routes that suit different interests, ranked by how common each was among people who got in. Nothing is required. Also return related paths that connect to this one and to what the student already has.
6. For any posting, use the notes and urls given for what this organizer's selection process is and what people who went through it say, and report the stages you can source in "process". For a posting the student has not applied to yet: check its qualifications, close the gaps, prepare each material and question, and end with submitting. For one already applied to: do not tell them to apply; write what to do while waiting, how to prepare for the next stage of that organizer's process, and what to keep building.
7. Plain language, no emoji, second person. For a posting: three to five phases and four to fourteen steps, in the order to do them. For a career: be exhaustive. Six to nine directions and thirty to fifty options in all, covering every kind of thing people did to get in: courses and skills, tools, projects, clubs and communities, events, competitions, research, certifications, jobs and internships, programs and scholarships, people to meet, and habits. It is a long open-ended menu, so do not trim it to a shortlist.`;

const lines = (label: string, items: string[]) => (items.length ? `${label}:\n${items.map((item) => `- ${item}`).join('\n')}` : `${label}: none given`);

export function roadmapPrompt(r: RoadmapRequest): string {
  const p = r.profile;
  const out = [
    r.kind === 'career' ? `Goal: break into ${r.goal}.` : `Goal: ${r.goal}.`,
    '',
    lines('NOTES FROM THE STUDENT (these override everything below)', p.notes),
    lines('Restrictions', p.restrictions),
    '',
    `Student: ${[p.year, p.major, p.school].filter(Boolean).join(', ') || 'nothing on the profile yet'}`,
    p.about ? `About: ${p.about}` : '',
    lines('Skills', p.skills),
    lines('Interests', p.interests),
    lines('Experience', p.experience.map((e) => `${e.role}${e.organization ? ` at ${e.organization}` : ''}${e.summary ? `: ${e.summary}` : ''}${e.skills.length ? ` (${e.skills.join(', ')})` : ''}`)),
    r.resume ? `Résumé text:\n${r.resume}` : 'Résumé: none uploaded',
    lines('Already done', r.done),
    lines('Set aside as not for them', r.setAside),
  ];
  if (r.posting) {
    const o = r.posting;
    out.push(
      '',
      `Posting: ${o.title} at ${o.organizer} (${o.type})`,
      `Application status: ${o.status}`,
      o.description ? `Description: ${o.description}` : '',
      lines('Tags', o.tags),
      `Deadline: ${o.deadline ?? 'unknown'}`,
      `Location: ${o.location ?? 'unknown'}`,
      lines('Materials asked for', o.materials),
      lines('Application questions', o.prompts),
      o.sourceUrl ? `Source: ${o.sourceUrl}` : '',
    );
  }
  out.push('', lines('Paths the app already holds', r.knownPaths.map((path) => `${path.outcome}: ${path.timeline.join('; ')}`)));
  if (r.chosen.length) out.push('', lines('Chosen by the student (category: option)', r.chosen.map((c) => `${c.category}: ${c.title}`)));
  out.push('', shape(r));
  return out.filter((line) => line !== '').join('\n');
}

/** The last thing the writer reads: the size and form this request needs. Models answer short without it. */
function shape(r: RoadmapRequest): string {
  if (r.kind === 'career' && r.chosen.length > 0)
    return 'Required shape of your answer: the student has finished choosing. Build their roadmap from exactly the options under "Chosen by the student". One phase per category they chose from, with the same title and an empty window. One step per chosen option, with the same title, and "actions": three to five concrete things to do for it, in order, written for this student. Add no step they did not choose. In each phase fill "more" with two to four further recommendations in that category that they have not chosen, each with why it would help this student next. Leave "process" empty.';
  if (r.kind === 'career')
    return 'Required shape of your answer: this is a board of options to pick from, not a plan. Return at least six phases, each one a direction with an empty window, and at least thirty steps in all, five or more per direction. Cover skills, tools, projects, clubs and communities, events, programs and research, people to talk to, and how to apply. A short answer is a wrong answer. Leave "process" empty. Return at least three relatedPaths.';
  if (r.posting?.status === 'applied')
    return 'Required shape of your answer: the application is already sent. No step may have kind "apply" and none may tell them to submit or apply to this posting. Mark every follow-up step with source "after". Fill "process" with the stages you could source.';
  return 'Required shape of your answer: three to five phases in the order to do them, ending with submitting. Fill "process" with the stages you could source.';
}

/** What fullEnough still wants from a draft, so a second fill can supply it without searching. */
function gaps(request: RoadmapRequest, roadmap: Roadmap): string[] {
  const steps = roadmap.phases.flatMap((phase) => phase.steps);
  const missing: string[] = [];
  if (request.kind === 'career' && request.chosen.length > 0) {
    const need = Math.ceil(request.chosen.length * 0.8);
    if (steps.length < need) missing.push(`at least ${need} steps from the chosen options (this draft has ${steps.length})`);
    if (steps.some((step) => step.actions.length < 2)) missing.push('at least two actions on every step');
    if (roadmap.phases.some((phase) => phase.more.length < 1)) missing.push('at least one further recommendation in more on every phase');
    return missing;
  }
  if (request.kind === 'career') {
    if (roadmap.phases.length < 5) missing.push(`at least 5 phases (this draft has ${roadmap.phases.length})`);
    if (steps.length < 20) missing.push(`at least 20 steps (this draft has ${steps.length})`);
    return missing;
  }
  if (request.posting?.status === 'applied') {
    if (steps.some((step) => step.kind === 'apply')) missing.push('no step with kind "apply"');
    return missing;
  }
  if (steps.length < 3) missing.push(`at least 3 steps (this draft has ${steps.length})`);
  return missing;
}

/** Whether an answer is as full as its form asks, so a thin one can be asked for again. */
export function fullEnough(request: RoadmapRequest, roadmap: Roadmap): boolean {
  return gaps(request, roadmap).length === 0;
}

export type RoadmapWriter = (request: RoadmapRequest) => Promise<GrokResult<Roadmap>>;

/** One answer per distinct request is kept, so reopening a roadmap does not pay for it again. */
export function cached(write: RoadmapWriter, limit = 200): RoadmapWriter {
  const kept = new Map<string, Promise<GrokResult<Roadmap>>>();
  return (request) => {
    const key = createHash('sha256').update(JSON.stringify(request)).digest('hex');
    let answer = kept.get(key);
    if (!answer) {
      answer = write(request);
      kept.set(key, answer);
      // A failed call is not remembered, and the oldest answers make room.
      answer.catch(() => kept.delete(key));
      if (kept.size > limit) kept.delete(kept.keys().next().value!);
    }
    return answer;
  };
}

/** What the one search call brings back. The fills read this; they do not search. */
const Research = z.object({
  notes: z.string(),
  urls: z.array(z.string()),
});

const SEARCH_SYSTEM = `You find out how people get into one path. Write notes on what the pages say, and list the urls of the pages that say so.`;

/** The one search: how people get into this path, and which pages say so. */
function searchPrompt(r: RoadmapRequest): string {
  const out = [`Path: ${r.goal}.`];
  if (r.posting) out.push(`Posting: ${r.posting.title} at ${r.posting.organizer} (${r.posting.type}).`);
  out.push('', 'How do people get into this path, and which pages say so?');
  if (r.knownPaths.length) out.push('', lines('Paths the app already holds', r.knownPaths.map((path) => `${path.outcome}: ${path.timeline.join('; ')}`)));
  return out.join('\n');
}

function evidence(notes: string, urls: string[]): string {
  const pages = urls.length ? urls.map((url) => `- ${url}`).join('\n') : '- none';
  return `Notes on how people get in:\n${notes.trim() || 'none'}\n\nPages:\n${pages}`;
}

/** The search call's citations, plus the page urls it listed. A fill with no tools cites nothing on its own. */
function cited(result: GrokResult<Roadmap>, research: { notes: string; urls: string[] }, fromSearch: string[]): GrokResult<Roadmap> {
  const citations: string[] = [];
  for (const url of [...fromSearch, ...research.urls, ...result.citations]) {
    if (/^https?:\/\//i.test(url) && !citations.includes(url)) citations.push(url);
  }
  return { data: result.data, citations };
}

/**
 * One search (web and X, two turns), then a fill of the roadmap schema with no tools.
 * A thin draft is filled once more from the same notes and urls, plus what is missing. That fill does not search.
 */
export const writeRoadmap: RoadmapWriter = async (request) => {
  // The normal tier of whichever transport is in use, as the master agent and managers use.
  const model = tierModels().normal;
  const found = await grokJson({
    name: 'roadmap_search',
    system: SEARCH_SYSTEM,
    user: searchPrompt(request),
    schema: Research,
    tools: [{ type: 'web_search' }, { type: 'x_search' }],
    maxTurns: 2,
    model,
  });
  const fill = (extra: string) =>
    grokJson({
      name: 'roadmap',
      system: SYSTEM,
      user: [roadmapPrompt(request), evidence(found.data.notes, found.data.urls), extra].filter(Boolean).join('\n\n'),
      schema: Roadmap,
      model,
    }).then((result) => cited(result, found.data, found.citations));

  const first = await fill('');
  if (fullEnough(request, first.data)) return first;
  const second = await fill(`What is missing: ${gaps(request, first.data).join('; ')}.`).catch(() => first);
  return fullEnough(request, second.data) ? second : first;
};
