// Opt-in live probe. `npm test` does not run this.
// Run: GROK_TRANSPORT=cli npm run probe:live
// Three grokJson calls against invented local pages, then a local quote check.
// Clock is 2026-11-25. GROK_CLI_ALWAYS_APPROVE is not used.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { grokJson } from '../src/grok.ts';
import { transport } from '../src/harness.ts';

const CLOCK = '2026-11-25';
const FIXTURE_DIR = fileURLToPath(new URL('../test/fixtures/live-probe/', import.meta.url));
const FILES = ['open.html', 'mismatch.html', 'closed.html'] as const;

const Out = z.object({
  found: z.boolean(),
  title: z.string(),
  deadline: z.string().nullable(),
  quote: z.string().nullable(),
});

type CaseId = 'open' | 'mismatch' | 'closed';
type CaseResult = {
  id: CaseId;
  title: string | null;
  deadline: string | null;
  quote: string | null;
  quoteSupported: boolean;
  elapsedMs: number;
  error?: string;
};

if (transport() === null) {
  console.error('No model is connected. Set GROK_TRANSPORT=cli for this process.');
  process.exit(1);
}

const fixtures = Object.fromEntries(FILES.map((file) => [file, readFileSync(join(FIXTURE_DIR, file), 'utf8')]));

function stripTags(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
}

function dropEmoji(text: string): string {
  return text.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '');
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return collapseWhitespace(dropEmoji(stripTags(text)));
}

function sentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

/** Every quote sentence of 12 or more characters must appear in the normalized fixture. */
function quoteSupported(quote: string | null, fixtureHtml: string): boolean {
  if (!quote) return false;
  const normalizedQuote = normalize(quote);
  const long = sentences(normalizedQuote).filter((s) => s.length >= 12);
  if (long.length === 0) return false;
  const page = normalize(fixtureHtml);
  return long.every((s) => page.includes(s));
}

function isFutureDeadline(deadline: string | null): boolean {
  if (!deadline?.trim()) return false;
  const day = deadline.trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day > CLOCK;
  const t = Date.parse(deadline);
  if (Number.isNaN(t)) return false;
  return t > Date.parse(`${CLOCK}T23:59:59-08:00`);
}

const server = http.createServer((req, res) => {
  const name = basename(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  const body = name && FILES.includes(name as (typeof FILES)[number]) ? fixtures[name] : null;
  if (body == null) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(body);
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as AddressInfo;
console.error(`transport: ${transport()}`);
console.error(`clock: ${CLOCK}`);
console.error(`serving http://127.0.0.1:${port}/{open,mismatch,closed}.html`);

const cases: { id: CaseId; file: (typeof FILES)[number] }[] = [
  { id: 'open', file: 'open.html' },
  { id: 'mismatch', file: 'mismatch.html' },
  { id: 'closed', file: 'closed.html' },
];

const results: Partial<Record<CaseId, CaseResult>> = {};

try {
  for (const c of cases) {
    const url = `http://127.0.0.1:${port}/${c.file}`;
    const started = Date.now();
    try {
      const { data } = await grokJson({
        name: `live_probe_${c.id}`,
        system: `Today is ${CLOCK}. Open the given URL with web fetch. Read only that page. Copy the application or registration deadline sentence from the page into quote, exactly as it appears. If the page states no deadline, set deadline to null and quote to null. Do not invent a date. Dates you do return are ISO 8601.`,
        user: `Open this URL and read the posting: ${url}\nCopy the sentence that states the application or registration deadline into quote, word for word from that page, or return deadline null and quote null when the page states none. Set title to the posting title. Set found true only if you opened this URL.`,
        schema: Out,
        tools: [{ type: 'web_search' }],
      });
      const row: CaseResult = {
        id: c.id,
        title: data.title,
        deadline: data.deadline,
        quote: data.quote,
        quoteSupported: quoteSupported(data.quote, fixtures[c.file]),
        elapsedMs: Date.now() - started,
      };
      results[c.id] = row;
      console.log(JSON.stringify({ title: row.title, deadline: row.deadline, quoteSupported: row.quoteSupported, elapsedMs: row.elapsedMs }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results[c.id] = {
        id: c.id,
        title: null,
        deadline: null,
        quote: null,
        quoteSupported: false,
        elapsedMs: Date.now() - started,
        error: message,
      };
      console.log(JSON.stringify({ title: null, deadline: null, quoteSupported: false, elapsedMs: Date.now() - started }));
      console.error(`${c.id}: ${message}`);
    }
  }
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

const reasons: string[] = [];
const open = results.open;
const mismatch = results.mismatch;
const closed = results.closed;
if (!open || open.error) reasons.push(`open call did not return${open?.error ? `: ${open.error}` : ''}`);
else if (!open.quoteSupported) reasons.push('open case quote is not supported by the fixture');
if (!mismatch || mismatch.error) reasons.push(`mismatch call did not return${mismatch?.error ? `: ${mismatch.error}` : ''}`);
else if (mismatch.deadline && mismatch.quoteSupported) reasons.push('mismatch case claimed a supported deadline');
if (!closed || closed.error) reasons.push(`closed call did not return${closed?.error ? `: ${closed.error}` : ''}`);
else if (isFutureDeadline(closed.deadline)) reasons.push(`closed case kept a future deadline (${closed.deadline})`);

if (reasons.length) {
  console.error(reasons.join('\n'));
  process.exit(1);
}
process.exit(0);
