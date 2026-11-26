// Frozen feed tasks: score a list of kept cards against expected titles and
// deadline quotes, using only the task's own HTML fixtures. No network, no model.

/** Clock every fixture date is written against. */
export const FIXED_CLOCK = '2026-11-25';

export interface KeptCard {
  title: string;
  url: string;
  deadline: string | null;
  deadlineQuote: string | null;
}

export interface TaskStudent {
  classYear: string;
  location: string;
  remoteOk: boolean;
  notes: string;
}

export interface RequiredCard {
  title: string;
  deadlineRequired: boolean;
}

export interface AgentTask {
  id: string;
  /** Scenario this fixture exists to cover, such as "closed-posting". */
  covers: string;
  student: TaskStudent;
  expected: {
    required: RequiredCard[];
    forbidden: string[];
  };
  /** URL of a posting page to the HTML of that page. */
  pages: Record<string, string>;
}

/** On-disk shape: `pages` maps each URL to a fixture filename, not the HTML. */
export interface AgentTaskSource extends Omit<AgentTask, 'pages'> {
  pages: Record<string, string>;
}

export interface TaskScore {
  pass: boolean;
  /** 1 only when every check holds; otherwise 0. */
  score: 0 | 1;
  reasons: string[];
}

const EMOJI = /\p{Extended_Pictographic}\uFE0F?/gu;

/** Strip tags, drop emoji, collapse whitespace. Used on both page HTML and quotes. */
export function pageText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(EMOJI, '');
  return stripped.replace(/\s+/g, ' ').trim();
}

/**
 * A quote is supported when every sentence of 12 or more characters, after the
 * same strip/collapse/emoji rule, appears in the page text.
 */
export function quoteSupported(quote: string, html: string): boolean {
  const q = pageText(quote);
  if (!q) return false;
  const page = pageText(html);
  const sentences = q.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length >= 12);
  if (sentences.length === 0) return page.includes(q);
  return sentences.every((s) => page.includes(s));
}

/** Fill `pages` by reading each named fixture file. */
export function hydrateTask(raw: AgentTaskSource, readFile: (name: string) => string): AgentTask {
  const pages: Record<string, string> = {};
  for (const [url, file] of Object.entries(raw.pages)) pages[url] = readFile(file);
  return { ...raw, pages };
}

const titleOf = (value: string) => value.trim();

/**
 * Score kept cards against a frozen task. Pure: the HTML for each URL is already
 * on the task. Score is 1 only when every required title is present, every
 * forbidden title is absent, a required title is not kept twice, and every
 * required deadline quote is supported by the HTML for that card's URL.
 */
export function scoreTask(task: AgentTask, kept: KeptCard[]): TaskScore {
  const reasons: string[] = [];
  const cards = kept.map((c) => ({ ...c, title: titleOf(c.title), url: c.url.trim() }));

  for (const required of task.expected.required) {
    const title = titleOf(required.title);
    const matches = cards.filter((c) => c.title === title);
    if (matches.length === 0) {
      reasons.push(`missing required title: ${title}`);
      continue;
    }
    if (matches.length > 1) reasons.push(`same posting kept at two urls: ${title}`);
    if (!required.deadlineRequired) continue;
    for (const card of matches) {
      const quote = card.deadlineQuote?.trim() ?? '';
      if (!quote) {
        reasons.push(`deadline quote missing: ${title}`);
        continue;
      }
      const html = task.pages[card.url] ?? '';
      if (!quoteSupported(quote, html)) reasons.push(`deadline quote not supported: ${title}`);
    }
  }

  for (const forbidden of task.expected.forbidden) {
    const title = titleOf(forbidden);
    if (cards.some((c) => c.title === title)) reasons.push(`forbidden title present: ${title}`);
  }

  const pass = reasons.length === 0;
  return { pass, score: pass ? 1 : 0, reasons };
}
