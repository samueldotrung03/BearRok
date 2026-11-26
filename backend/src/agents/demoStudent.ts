// The demo student everyone sees before they sign in: John, a computer science major at UC
// Berkeley, with a feed of real postings.
//
// Every posting here was read from its own page on CHECKED: Luma event pages, berkeley.edu pages
// and companies' own careers pages. Nothing is invented. A date, deadline or place the page does
// not state is left unknown. The postings go out of date: refresh this list, or connect a model
// and let the agents search, rather than editing dates by hand.
import type { Store } from '../store/index.ts';
import { DEMO_PROFILE, UNKNOWN_DEADLINE } from './system.ts';
import { CATEGORY_OF, type Evidence, type Opportunity, type OppType, type Profile, type ProfileMemory, type StudentMemory } from './types.ts';

/** The day the pages were read. */
export const CHECKED = '2026-11-25';
const CHECKED_AT = `${CHECKED}T20:00:00.000Z`;
export const DEMO_STUDENT_ID = 'guest:demo';

export const JOHN: Profile = {
  name: 'John',
  school: 'UC Berkeley',
  year: 'Junior',
  major: 'Computer Science',
  location: 'Berkeley, CA',
  remoteOk: true,
  interests: ['software engineering', 'artificial intelligence', 'hackathons'],
  skills: ['Python', 'Java', 'C++'],
  categories: ['internship', 'event', 'club', 'program'],
  careerInterests: ['Software engineer', 'Machine learning engineer'],
  eventTypes: ['Hackathons', 'Tech talks'],
  preferences: null,
};

interface Row {
  id: string;
  type: OppType;
  title: string;
  organizer: string;
  sourceUrl: string;
  actionUrl?: string;
  format?: Opportunity['format'];
  location?: string;
  field: string;
  tags: string[];
  description: string;
  eligibility?: string;
  /** YYYY-MM-DD, with the words on the page that give it. */
  deadline?: [day: string, quote: string];
  /** When it starts, with where that was read. */
  start?: [time: string, quote: string];
  image?: string;
  /** How well it fits John, 0 to 100, and why in one sentence. */
  fit: [score: number, reason: string];
}

const luma = (slug: string) => `https://luma.com/${slug}`;
const cover = (path: string) => `https://images.lumacdn.com/uploads/${path}`;
const LUMA_TIME = "Start time in the event's Luma listing";

const ROWS: Row[] = [
  // Hackathons listed on Luma.
  {
    id: 'draki-pink-hackathon',
    type: 'hackathon',
    title: 'Draki Pink Hackathon',
    organizer: 'Draki',
    sourceUrl: luma('8itaqp8x'),
    format: 'in_person',
    location: 'San Francisco, CA',
    field: 'Mobile apps',
    tags: ['mobile apps', 'consumer', 'one-day'],
    description: 'A day of building consumer mobile apps with founders, developers and designers, where every app has to be fully pink. It ends with demos and judging.',
    eligibility: 'Approval required to attend. Bring a laptop.',
    start: ['2026-12-04T18:00:00.000Z', 'December 4, 2026 · San Francisco'],
    image: cover('44/7c5c8f41-75e7-4cda-bd02-022782a34a71.png'),
    fit: [74, 'A one-day build event across the bay from Berkeley, on a weekday John would need free.'],
  },
  {
    id: 'node-human-in-the-loop',
    type: 'hackathon',
    title: 'Human in the Loop: Creative Hackathon',
    organizer: 'NODE',
    sourceUrl: luma('node-hackathon'),
    format: 'in_person',
    location: 'NODE, 180 University Ave, Palo Alto, CA',
    field: 'Art and technology',
    tags: ['creative tech', 'generative video', 'students only'],
    description: 'A weekend art and technology hackathon with guest artists, in three tracks: generative video, audio-visual art and interactive experiences. It runs through December 6.',
    eligibility: 'Open only to participants with a valid student ID. All experience levels.',
    start: ['2026-12-05T02:00:00.000Z', LUMA_TIME],
    image: cover('pl/e4abc81f-f17f-4568-9753-8bfdda483418.png'),
    fit: [80, 'Students only and open to every experience level, which suits an undergraduate looking for hackathons.'],
  },
  {
    id: 'great-business-bake-off',
    type: 'hackathon',
    title: 'The Great Business Bake Off: an AI Agent Hackathon',
    organizer: 'Theory Ventures, with MotherDuck and LanceDB',
    sourceUrl: luma('bakeoff'),
    format: 'in_person',
    location: 'San Francisco, CA',
    field: 'AI agents',
    tags: ['AI agents', 'solo', 'data'],
    description: 'A solo hackathon where each participant uses AI agents to run a bakery business and make it the most profitable in town.',
    eligibility: 'For AI engineers, data scientists and founders who build with agents. Host approval required.',
    start: ['2026-12-11T21:00:00.000Z', LUMA_TIME],
    image: cover('kc/a2841872-d08a-4ba5-bb5e-feac7947f63a.png'),
    fit: [68, 'On AI agents, which John is interested in, though it is aimed at working engineers and needs approval.'],
  },
  {
    id: 'agentic-ai-hackathon-sf',
    type: 'hackathon',
    title: 'Agentic AI Hackathon 2.0 - SF',
    organizer: 'Devnovate, at the AWS Builder Loft',
    sourceUrl: luma('12545fxr'),
    format: 'in_person',
    location: 'AWS Builder Loft, 525 Market St, San Francisco, CA',
    field: 'AI agents',
    tags: ['agentic AI', 'AWS', 'mentorship'],
    description: 'A one-day hackathon at the AWS Builder Loft with building sessions, mentors, prizes for the top teams and a chance to demo to people in industry.',
    eligibility: 'Guests must be 18 or older and show a government-issued photo ID. Host approval required.',
    start: ['2026-12-15T17:30:00.000Z', '09:30 AM – 7:00 PM, 15th December 2026'],
    image: cover('sk/d406532c-92e4-4aab-b965-914a5f47fe3b.jpg'),
    fit: [82, 'A one-day AI hackathon with mentors, in San Francisco, open to anyone 18 or older.'],
  },
  {
    id: 'trading-agents-winterhack',
    type: 'hackathon',
    title: 'Trading Agents Winterhack (Christmas Edition)',
    organizer: 'Finch.AI',
    sourceUrl: luma('finch-yeg0'),
    format: 'in_person',
    location: 'AWS Builder Loft, 525 Market St, San Francisco, CA',
    field: 'AI agents',
    tags: ['AI agents', 'marketplace', 'AWS'],
    description: 'Participants build agents, skills or tools, sell them to each other for virtual money, then combine what they bought with their own work into a final project.',
    eligibility: '18 or older, with a government-issued photo ID at check-in.',
    start: ['2026-12-18T17:30:00.000Z', LUMA_TIME],
    image: cover('68/e94c193a-bf57-4cba-92d6-2ec5b5b876dd.png'),
    fit: [76, 'Hands-on work with AI agents in San Francisco, open to anyone 18 or older.'],
  },
  {
    id: 'physical-ai-hack',
    type: 'hackathon',
    title: 'Physical AI Hack',
    organizer: 'tokens&',
    sourceUrl: luma('physicalhack'),
    format: 'in_person',
    location: 'San Francisco, CA',
    field: 'Robotics and AI',
    tags: ['physical AI', 'robotics', 'world models'],
    description: 'A hackathon on AI that perceives, reasons and acts in the physical world, with a focus on perception, world models, dexterity and autonomy. It ends with demos and judging.',
    eligibility: 'For robotics and machine learning engineers, researchers, hardware builders and developers exploring physical AI. Teams of 2 to 4. Approval required.',
    start: ['2027-01-16T17:30:00.000Z', LUMA_TIME],
    image: cover('on/d6990f90-5f1a-4941-abc0-d1bf68cc2050.png'),
    fit: [70, 'Applied AI on a Saturday in San Francisco, for someone ready to work with hardware.'],
  },

  // UC Berkeley pages.
  {
    id: 'urap-spring-2027',
    type: 'research',
    title: 'Undergraduate Research Apprentice Program (URAP), Spring 2027',
    organizer: 'UC Berkeley Office of Undergraduate Research and Scholarships',
    sourceUrl: 'https://research.berkeley.edu/urap/',
    actionUrl: 'https://research.berkeley.edu/urap/application/',
    field: 'Undergraduate research',
    tags: ['URAP', 'research apprenticeship', 'academic credit'],
    description: 'URAP places undergraduates as apprentices on faculty research projects for the term. The application opens on January 15, 2027. The work is unpaid and earns academic credit.',
    eligibility: 'Open to matriculated UC Berkeley undergraduates.',
    deadline: ['2027-01-25', 'The deadline to apply is Monday, January 25th at 12pm noon.'],
    fit: [88, 'Open to every Berkeley undergraduate, and the usual first step into a faculty lab for a computer science major.'],
  },
  {
    id: 'surf-ls-2027',
    type: 'research',
    title: 'SURF L&S: Summer Undergraduate Research Fellowships',
    organizer: 'UC Berkeley Office of Undergraduate Research and Scholarships',
    sourceUrl: 'https://research.berkeley.edu/surf/',
    field: 'Summer research',
    tags: ['SURF', 'summer research', 'fellowship', 'faculty mentor'],
    description: 'SURF L&S funds a full-time summer research project of at least seven weeks, mentored by a Berkeley faculty member.',
    eligibility: 'College of Letters and Science students, juniors or seniors, with at least a 3.0 GPA and a faculty mentor.',
    deadline: ['2027-03-19', 'Applications for SURF L&S are due by 12:00 NOON (Pacific Time) on Friday, March 19, 2027'],
    fit: [78, 'A funded summer of research for a junior, if John is in the College of Letters and Science and has a faculty mentor.'],
  },
  {
    id: 'amgen-scholars-2027',
    type: 'research',
    title: 'UC Berkeley Amgen Scholars Program',
    organizer: 'UC Berkeley Amgen Scholars Program',
    sourceUrl: 'https://amgenscholars.berkeley.edu/',
    actionUrl: 'http://amgenscholars.berkeley.edu/applicants/',
    location: 'UC Berkeley, Berkeley, CA',
    field: 'Science research',
    tags: ['Amgen Scholars', 'summer research', 'computational biology'],
    description: 'A summer research program at UC Berkeley for students aiming at careers in the sciences. Computational biology is among its research areas.',
    eligibility: 'U.S. citizens or permanent residents; sophomores, juniors and non-graduating seniors at four-year U.S. colleges with a GPA of 3.2 or higher.',
    deadline: ['2027-02-01', 'Application Deadline: February 1, 2027'],
    fit: [58, 'A fit only if John wants to apply computing to biology; it is not a computer science program.'],
  },
  {
    id: 'goldwater-scholarship-2027',
    type: 'scholarship',
    title: 'Goldwater Scholarship (Berkeley campus nomination)',
    organizer: 'UC Berkeley Office of Undergraduate Research and Scholarships',
    sourceUrl: 'https://scholarships.berkeley.edu/goldwater/',
    actionUrl: 'https://goldwaterscholarship.gov/students/nomination/',
    field: 'Science, mathematics and engineering research',
    tags: ['Goldwater', 'scholarship', 'research career'],
    description: 'A national scholarship for students planning research careers. Berkeley applicants first fill in an interest form and meet the campus representative, then submit a research essay, three letters and transcripts.',
    eligibility: 'Full-time sophomores or juniors; U.S. citizens, nationals or permanent residents; GPA of at least 3.0; planning a research career in the natural sciences, mathematics or engineering.',
    deadline: ['2026-12-14', 'Next Campus Deadline: Noon, December 14, 2026'],
    fit: [55, 'Open to juniors, but meant for students set on a research career, and the campus deadline is close.'],
  },
  {
    id: 'blueprint-developers',
    type: 'club',
    title: 'Blueprint: student developer applications',
    organizer: 'Blueprint, a UC Berkeley student organization',
    sourceUrl: 'https://calblueprint.org',
    actionUrl: 'https://calblueprint.org/apply/students',
    location: 'Berkeley, CA',
    field: 'Software for nonprofits',
    tags: ['Blueprint', 'student developers', 'nonprofits'],
    description: 'Blueprint builds software for nonprofit organizations. Its site says applications for student developers open at the beginning of each semester and gives no dates.',
    fit: [84, 'Real software projects with a team on campus, which is the experience internship postings ask for.'],
  },
  {
    id: 'cdss-data-discovery-symposium',
    type: 'event',
    title: 'CDSS Data Discovery Fall Symposium',
    organizer: 'UC Berkeley College of Computing, Data Science, and Society',
    sourceUrl: 'https://events.berkeley.edu/live/events/332377-cdss-data-discovery-fall-symposium',
    format: 'in_person',
    location: 'The Gateway, UC Berkeley',
    field: 'Data science',
    tags: ['CDSS', 'symposium', 'data science'],
    description: 'A symposium from the college that houses computer science at Berkeley. The listing gives the time and place and no further description.',
    start: ['2026-12-09T21:30:00.000Z', 'Wednesday December 9, 2026 | 1:30 PM – 3:00 PM'],
    fit: [66, 'On campus and from John’s own college, a short way to see student data science projects.'],
  },
  {
    id: 'eecs-colloquium-power-electronics',
    type: 'event',
    title: 'EECS Colloquium: Pursuing a "Moore’s Law" for Power Electronics',
    organizer: 'UC Berkeley Electrical Engineering and Computer Sciences',
    sourceUrl: 'https://events.berkeley.edu/eecs/event/329452-eecs-colloquium-pursuing-a-moores-law-for-power-elect',
    format: 'in_person',
    location: '1220 Gateway, UC Berkeley',
    field: 'Electrical engineering and computer science',
    tags: ['EECS', 'colloquium', 'tech talk'],
    description: 'A talk in the EECS department’s colloquium series. The listing gives the title, time and room; the speaker is not confirmed.',
    start: ['2026-12-03T00:00:00.000Z', 'Wednesday December 2, 2026 | 4:00 PM'],
    fit: [48, 'A department tech talk on campus, on hardware more than software.'],
  },

  // Internships on the companies' own careers pages. None of them states a closing date.
  {
    id: 'scale-ai-swe-intern-2027',
    type: 'internship',
    title: 'Software Engineering Intern (Summer 2027)',
    organizer: 'Scale AI',
    sourceUrl: 'https://scale.com/careers/4730845005',
    location: 'San Francisco, CA',
    field: 'Software engineering',
    tags: ['Python', 'TypeScript', 'React', 'LLMs'],
    description: 'Example projects include data pipelines for training models, infrastructure for evaluating models, and applications built on AI agents with their testing tools.',
    eligibility: 'Graduating in Fall 2027 or Spring 2028 with a bachelor’s degree in a relevant field, with a previous software internship.',
    fit: [86, 'Software engineering on AI systems in San Francisco, for the graduation years a junior falls in.'],
  },
  {
    id: 'hp-iq-aml-platform-intern-2027',
    type: 'internship',
    title: 'Software Engineering Intern, AML Platform (Summer 2027)',
    organizer: 'HP IQ',
    sourceUrl: 'https://job-boards.greenhouse.io/hpiq/jobs/6114781004',
    location: 'San Francisco, CA',
    field: 'Machine learning engineering',
    tags: ['Python', 'PyTorch', 'on-device AI', 'agents'],
    description: 'Interns work on making model inference faster, on workflows that coordinate agents, and on fine-tuning language models for devices with limited resources.',
    eligibility: 'Pursuing a degree in computer science, engineering or a related field, or equivalent practical experience.',
    fit: [85, 'Machine learning engineering in Python, in San Francisco, open to any computer science student.'],
  },
  {
    id: 'c3-ai-swe-intern-2027',
    type: 'internship',
    title: 'Software Engineer - Intern (Summer 2027)',
    organizer: 'C3 AI',
    sourceUrl: 'https://c3.ai/job-description/8739037002?gh_jid=8739037002',
    format: 'in_person',
    location: 'Redwood City, CA',
    field: 'Software engineering',
    tags: ['Java', 'JavaScript', 'data structures', 'algorithms'],
    description: 'Interns design, build and maintain applications that scale, and build tools that internal teams use to analyze large amounts of data.',
    eligibility: 'Pursuing a bachelor’s or master’s degree in computer science, computer engineering or a related field.',
    fit: [83, 'A Bay Area software internship in Java, one of the languages on John\u2019s profile.'],
  },
  {
    id: 'amazon-sde-intern-agi-2027',
    type: 'internship',
    title: 'Software Development Engineer Intern - Artificial General Intelligence (Summer 2027)',
    organizer: 'Amazon',
    sourceUrl: 'https://amazon.jobs/en/jobs/10606968/software-development-engineer-intern-artificial-general-intelligence-summer-2027',
    format: 'in_person',
    location: 'Sunnyvale, CA; Seattle, WA; Bellevue, WA; Boston, MA',
    field: 'Software engineering',
    tags: ['Java', 'Python', 'C++', 'distributed systems'],
    description: 'Interns design, build and run distributed cloud services with teams across the organization, and take part in code reviews and fixing problems in production.',
    eligibility: 'Enrolled in a bachelor’s degree or above in computer science, computer engineering or data science at a school in the United States, with at least one term left after the internship.',
    fit: [84, 'Distributed systems work in the languages on John\u2019s profile, with a Bay Area location among the choices.'],
  },
  {
    id: 'veeva-swe-intern-pleasanton-2027',
    type: 'internship',
    title: 'Intern Software Engineer (Summer 2027)',
    organizer: 'Veeva Systems',
    sourceUrl: 'https://jobs.lever.co/veeva/f277bc52-1dd6-4447-ac3b-a6127e625ec7',
    actionUrl: 'https://jobs.lever.co/veeva/f277bc52-1dd6-4447-ac3b-a6127e625ec7/apply',
    format: 'in_person',
    location: 'Pleasanton, CA',
    field: 'Software engineering',
    tags: ['Java', 'Python', 'TypeScript', 'React'],
    description: 'Interns join an engineering team at the Pleasanton office for a full-time summer program in the office.',
    eligibility: 'Graduating in Spring 2028 or earlier with a bachelor’s degree in computer science or a related field, with a compilers or operating systems class. No visa sponsorship.',
    fit: [80, 'In the East Bay, close to Berkeley, for students graduating by Spring 2028.'],
  },
  {
    id: 'amazon-front-end-intern-2027',
    type: 'internship',
    title: 'Front-End Engineer Internship - 2027 (US)',
    organizer: 'Amazon',
    sourceUrl: 'https://amazon.jobs/en/jobs/10609992/front-end-engineer-internship-2027-us',
    format: 'in_person',
    location: 'Seattle, WA; Bellevue, WA; Chicago, IL',
    field: 'Front-end engineering',
    tags: ['JavaScript', 'HTML', 'CSS', 'React'],
    description: 'Interns build front-end components and improvements with their team, turn feature specifications into code that can be maintained, and take part in code reviews.',
    eligibility: 'Enrolled in a bachelor’s or master’s program at a school in the United States, with a degree expected between October 2027 and December 2030.',
    fit: [64, 'A software internship John qualifies for, but outside the Bay Area and in front-end work, which is not his listed strength.'],
  },
  {
    id: 'icapital-si-annuities-intern-2027',
    type: 'internship',
    title: 'SI and Annuities - Summer 2027 Intern',
    organizer: 'iCapital',
    sourceUrl: 'https://job-boards.greenhouse.io/icapitalnetwork/jobs/8958714002',
    format: 'in_person',
    location: 'New York, NY',
    field: 'Software engineering',
    tags: ['Java', 'Python', 'React', 'fintech'],
    description: 'Interns build parts of a platform for investment workflows, with APIs and web pages, and work with the data science team on a service that uses machine learning and language processing.',
    eligibility: 'Rising juniors or seniors in a U.S. bachelor’s program, in the New York office five days a week. No visa sponsorship.',
    fit: [60, 'Java and Python work for rising seniors, but it is in New York, in person.'],
  },
  {
    id: 'bandwidth-swe-intern-2027',
    type: 'internship',
    title: 'Software Engineer Intern - Summer 2027',
    organizer: 'Bandwidth',
    sourceUrl: 'https://job-boards.greenhouse.io/bandwidth/jobs/8414440',
    location: 'Raleigh, NC',
    field: 'Software engineering',
    tags: ['Java', 'microservices', 'AWS'],
    description: 'Interns write code on the team behind the company’s phone numbers API and help build new services with experienced engineers.',
    eligibility: 'Working toward a bachelor’s degree in computer science, computer engineering or a similar course of study.',
    fit: [56, 'Backend work in Java for any computer science student, but in North Carolina.'],
  },
  {
    id: 'veeva-swe-intern-boston-2027',
    type: 'internship',
    title: 'Intern Software Engineer (Summer 2027)',
    organizer: 'Veeva Systems',
    sourceUrl: 'https://jobs.lever.co/veeva/4738ae75-9f7b-4082-b129-69fb82f6d7b2',
    actionUrl: 'https://jobs.lever.co/veeva/4738ae75-9f7b-4082-b129-69fb82f6d7b2/apply',
    format: 'in_person',
    location: 'Boston, MA',
    field: 'Software engineering',
    tags: ['software engineering', 'in the office'],
    description: 'Interns work as software engineers on an engineering team at the Boston office for the summer.',
    eligibility: 'Graduating in Spring 2028 or earlier with a bachelor’s degree in computer science or a related field and a GPA of 3.0 or higher. No visa sponsorship.',
    fit: [52, 'The same program as the Pleasanton posting, across the country in Boston.'],
  },
];

function posting(r: Row): Opportunity {
  const evidence: Evidence[] = [];
  if (r.deadline) evidence.push({ field: 'deadline', quote: r.deadline[1], url: r.sourceUrl });
  if (r.start) evidence.push({ field: 'startTime', quote: r.start[1], url: r.sourceUrl });
  return {
    id: `john-${r.id}`,
    origin: 'live',
    type: r.type,
    title: r.title,
    organizer: r.organizer,
    sourceUrl: r.sourceUrl,
    actionUrl: r.actionUrl ?? null,
    format: r.format ?? null,
    location: r.location ?? null,
    field: r.field,
    tags: r.tags,
    description: r.description,
    eligibility: r.eligibility ?? null,
    eligibleYears: null,
    deadline: r.deadline?.[0] ?? null,
    deadlineSource: r.deadline ? 'official' : null,
    startTime: r.start?.[0] ?? null,
    image: r.image ?? null,
    imageKind: r.image ? 'event' : null,
    evidence,
    fitExplanation: r.fit[1],
    unknowns: r.deadline ? [] : [{ field: 'deadline', label: UNKNOWN_DEADLINE[CATEGORY_OF[r.type]] }],
    foundAt: CHECKED_AT,
    lastCheckedAt: CHECKED_AT,
    baseScore: r.fit[0] / 100,
    foundBy: `Web check on ${CHECKED}`,
    alsoSeenAt: [],
    application: null,
  };
}

/** John's memory: his profile and the real postings, with no reactions yet. */
export function demoMemory(): StudentMemory {
  const postings = ROWS.map(posting);
  return {
    version: 1,
    updatedAt: CHECKED_AT,
    // Only what John set; everything else keeps the app's defaults.
    profile: { profile: structuredClone(JOHN), resume: null, scheduleSeconds: 0 } as unknown as ProfileMemory,
    learned: {
      interactions: [],
      opportunities: postings,
      reasons: Object.fromEntries(postings.map((o) => [o.id, o.fitExplanation])),
      rejected: [],
      rejectedUrls: [],
      searches: [],
      runs: [],
      lastRun: null,
      applications: [],
      // Counted as one search already made, so opening the demo does not start a simulated
      // search that would put invented samples next to these.
      runCount: 1,
    },
  };
}

type Memory = Pick<Store, 'loadStudent' | 'saveStudent' | 'deleteStudent'>;

/**
 * The demo student starts as John: when nothing is saved for them yet, or what is saved is still
 * the earlier invented student, untouched. Once a visitor changes the demo profile it is theirs
 * and is left alone.
 */
export function withDemoStudent(memory: Memory): Memory {
  return {
    saveStudent: (id, m) => memory.saveStudent(id, m),
    deleteStudent: (id) => memory.deleteStudent(id),
    loadStudent: async (id) => {
      const saved = await memory.loadStudent(id);
      if (id !== DEMO_STUDENT_ID) return saved;
      return !saved || saved.profile?.profile?.name === DEMO_PROFILE.name ? demoMemory() : saved;
    },
  };
}
