// Grok through the Grok Build CLI (`grok -p ...`), signed in with a Grok subscription.
// Same job as the API client in grok.ts: send one prompt, get one JSON answer back.
// Usage is counted against the subscription of whoever ran `grok login` on this machine.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { currentSignal, StoppedError } from './agents/stop.ts';
import { config } from './config.ts';
import type { GrokResult, GrokTool } from './grok.ts';

/** An empty folder for the CLI to run in, so a coding agent has no project files in reach. */
function sandboxDir(): string {
  const dir = join(tmpdir(), 'bearok-grok-cli');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The real CLI is an executable. Tests point GROK_CLI_BIN at a `.mjs` stand-in, which Node runs. */
function startCli(args: string[]) {
  const bin = config.grokCli.bin;
  const opts = { cwd: sandboxDir(), stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] };
  if (/\.mjs$/i.test(bin)) return spawn(process.execPath, [bin, ...args], opts);
  return spawn(bin, args, opts);
}

/** Set `AGENT_DEBUG=1` to keep every prompt and the CLI's raw stdout. Off for normal runs. */
export const agentDebug = () => process.env.AGENT_DEBUG === '1';

const debugFile = () => join(tmpdir(), 'bearok-agent-debug.jsonl');

function debugLog(entry: Record<string, unknown>) {
  const name = String(entry.name ?? 'grok');
  const event = String(entry.event ?? '');
  const detail = entry.detail ? ` ${entry.detail}` : '';
  if (event === 'fail' || agentDebug()) console.error(`[agent] ${name} ${event}${detail}`);
  if (!agentDebug()) return;
  try {
    appendFileSync(debugFile(), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // A debug log must not sink a search.
  }
}

/**
 * `grok-4.3` is the API low-tier default and is not a model this CLI lists
 * (`grok models`: grok-4.7, grok-4.7-build-fast, grok-4.6, grok-4.5). Passing it fails the call.
 */
export function cliModel(model: string | undefined): string | undefined {
  if (!model) return undefined;
  if (model === 'grok-4.3') {
    console.warn('grok CLI has no grok-4.3 model; this call uses the CLI default.');
    return undefined;
  }
  return model;
}

/**
 * Arguments for one headless call. Web search and opening pages are allowed by name.
 * A headless run cannot ask, so without `--allow WebFetch` the CLI cancels every page open
 * and the reader returns an empty record. `--always-approve` is not used unless the operator
 * sets GROK_CLI_ALWAYS_APPROVE=1; it would also approve shell and file tools.
 */
export function cliArguments(opts: { prompt: string; model?: string; tools: boolean; schema?: string; effort?: string; alwaysApprove?: boolean; cwd: string }): string[] {
  const args = ['-p', opts.prompt, '--output-format', 'json', '--cwd', opts.cwd, '--no-subagents'];
  const model = cliModel(opts.model);
  if (model) args.push('-m', model);
  if (opts.effort) args.push('--reasoning-effort', opts.effort);
  if (!opts.tools) args.push('--disable-web-search');
  else args.push('--allow', 'WebSearch', '--allow', 'WebFetch');
  if (opts.schema) args.push('--json-schema', opts.schema);
  if (opts.tools && opts.alwaysApprove) args.push('--always-approve');
  return args;
}

type CliRun = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

function run(args: string[], timeoutMs: number): Promise<CliRun> {
  const stop = currentSignal();
  if (stop?.aborted) return Promise.reject(new StoppedError());
  return new Promise((resolve, reject) => {
    const child = startCli(args);
    let out = '';
    let err = '';
    let settled = false;
    let timedOut = false;
    const finish = (result: CliRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop?.removeEventListener('abort', onStop);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    // The student stopped the search: end this call now rather than when it finishes.
    const onStop = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new StoppedError());
    };
    stop?.addEventListener('abort', onStop, { once: true });
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stop?.removeEventListener('abort', onStop);
      reject(new Error(e.code === 'ENOENT' ? `grok CLI not found at "${config.grokCli.bin}". Install it and run "grok login".` : e.message));
    });
    child.on('close', (code) => finish({ stdout: out, stderr: err, code, timedOut }));
  });
}

/** The CLI's `json` output wraps the answer in an object; its field names are not documented, so look in the likely places. */
export function answerText(stdout: string): string {
  const raw = stdout.trim();
  try {
    const body = JSON.parse(raw);
    if (typeof body === 'string') return body;
    for (const key of ['result', 'response', 'text', 'output', 'content', 'message']) {
      const v = body?.[key];
      if (typeof v === 'string' && v.trim()) return v;
      if (typeof v?.content === 'string') return v.content;
      if (typeof v?.text === 'string') return v.text;
    }
    // The answer itself may already be the JSON we asked for.
    return raw;
  } catch {
    return raw;
  }
}

/** The answer the CLI checked against the schema it was given (`--json-schema`), when it returned one. */
export function structuredAnswer(stdout: string): unknown {
  try {
    const body = JSON.parse(stdout.trim());
    const v = body?.structuredOutput ?? body?.structured_output;
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Every complete top-level JSON object in a reply, in the order written. */
export function jsonObjects(text: string): unknown[] {
  const found: unknown[] = [];
  let i = 0;
  while ((i = text.indexOf('{', i)) >= 0) {
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === '\\') j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end < 0) break;
    try {
      found.push(JSON.parse(text.slice(i, end + 1)));
      i = end + 1;
    } catch {
      i += 1;
    }
  }
  return found;
}

/**
 * The fullest answer in the CLI's output that fits the schema. The CLI sometimes writes an empty
 * copy of the shape before or between its searches, in its text or as its checked answer, so the
 * first object found is not always the real one.
 */
/**
 * How much of an object is a real answer. The CLI sometimes fills the schema with the word
 * "placeholder" or blank strings, and that stub can be longer than the real object written later.
 * Blanks and the literal placeholder lose to a shorter answer that has actual text.
 */
export function answerSubstance(value: unknown): number {
  const text = JSON.stringify(value);
  const placeholders = text.match(/"placeholder"/gi)?.length ?? 0;
  const blanks = text.match(/""/g)?.length ?? 0;
  return text.length - placeholders * 400 - blanks * 30;
}

export function fullestAnswer<S extends z.ZodType>(stdout: string, schema: S): z.infer<S> {
  const candidates = [structuredAnswer(stdout), ...jsonObjects(answerText(stdout))].filter((c) => c !== undefined);
  let best: { data: z.infer<S>; score: number } | null = null;
  let firstError: unknown;
  for (const c of candidates) {
    const parsed = schema.safeParse(c);
    if (!parsed.success) {
      firstError ??= parsed.error;
      continue;
    }
    const score = answerSubstance(parsed.data);
    if (!best || score > best.score) best = { data: parsed.data, score };
  }
  if (best) return best.data;
  const issues = firstError && typeof firstError === 'object' && 'issues' in firstError && Array.isArray(firstError.issues) ? firstError.issues : [];
  const hint = issues.slice(0, 3).map((i) => `${(Array.isArray(i.path) ? i.path : []).join('.') || '(root)'}: ${i.message}`).join('; ');
  throw new Error(hint ? `the reply did not match the schema (${hint})` : 'the reply contained no JSON object');
}

/** Pull the first complete JSON object out of a reply that may have prose or code fences around it. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(c.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('the reply contained no JSON object');
}

export async function grokCliJson<S extends z.ZodType>(opts: {
  name: string;
  system: string;
  user: string;
  schema: S;
  tools?: GrokTool[];
  model?: string;
  timeoutMs?: number;
}): Promise<GrokResult<z.infer<S>>> {
  const schema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete schema.$schema;
  const schemaJson = JSON.stringify(schema);
  const prompt = [
    opts.system,
    opts.tools?.length
      ? 'Use web search and open the pages (web fetch). Both are already allowed. Do not read, write or run anything on this computer, and do not use any other tool. If a page cannot be opened, say so in the JSON; do not invent the page.'
      : 'Answer from the information given. Do not use any tools.',
    `Reply with one JSON object and nothing else: no explanation, no code fence. Write it once, after your research is done, never as an empty placeholder and never with the word "placeholder" as a value. It must match this JSON Schema:\n${schemaJson}`,
    `---\n${opts.user}`,
  ].join('\n\n');
  const timeoutMs = opts.timeoutMs ?? config.grokCli.timeoutMs;
  const base = { prompt, model: opts.model, tools: Boolean(opts.tools?.length), effort: config.grokCli.effort, alwaysApprove: config.grokCli.alwaysApprove, cwd: sandboxDir() };

  let lastError: unknown;
  // One retry, without the schema option in case the CLI turned the schema down: the prompt still asks for the JSON.
  for (let attempt = 0; attempt < 2; attempt++) {
    const args = cliArguments({ ...base, schema: attempt === 0 ? schemaJson : undefined });
    try {
      const result = await run(args, timeoutMs);
      debugLog({
        name: opts.name,
        event: 'call',
        detail: `attempt ${attempt + 1} exit ${result.code ?? 'none'}${result.timedOut ? ' timeout' : ''} stdout ${result.stdout.length}b`,
        model: cliModel(opts.model) ?? 'cli default',
        tools: base.tools,
        prompt,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      try {
        const data = fullestAnswer(result.stdout, opts.schema);
        if (result.timedOut || result.code !== 0) {
          console.warn(`grok ${opts.name}: kept a JSON answer from a CLI run that ${result.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)}s` : `exited ${result.code}`}`);
        }
        return { data, citations: [] };
      } catch (parseError) {
        const parsed = parseError instanceof Error ? parseError.message : String(parseError);
        const why = result.timedOut
          ? `grok CLI timed out after ${Math.round(timeoutMs / 1000)}s`
          : result.code !== 0
            ? `grok CLI exited ${result.code}: ${(result.stderr || result.stdout).trim().slice(0, 400)}`
            : parsed;
        lastError = new Error(why);
        console.warn(`grok ${opts.name}: dropped answer (${why})`);
        debugLog({ name: opts.name, event: 'fail', detail: why, stdout: result.stdout, stderr: result.stderr });
        if (result.timedOut || /not found/.test(why)) break;
      }
    } catch (e) {
      lastError = e;
      const message = e instanceof Error ? e.message : String(e);
      if (!(e instanceof StoppedError)) console.warn(`grok ${opts.name}: ${message}`);
      debugLog({ name: opts.name, event: 'fail', detail: message });
      if (e instanceof StoppedError || /not found|timed out/.test(message)) break;
    }
  }
  throw lastError;
}
