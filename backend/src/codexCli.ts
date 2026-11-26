// The ChatGPT harness: the agents on ChatGPT through the Codex CLI (`codex exec`), on the ChatGPT
// account signed in on this computer (`codex login`). API key settings are removed before each
// call (harness.ts), so it can only use that subscription.
//
// Same job as grok.ts, claudeCli.ts and grokCli.ts: send one prompt, get one JSON answer back.
// Codex is a coding agent, so it runs in an empty folder with a read-only sandbox: it can search
// the web when asked to, and cannot change anything on the computer.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { currentSignal, StoppedError } from './agents/stop.ts';
import { config } from './config.ts';
import type { GrokResult, GrokTool } from './grok.ts';
import { fullestAnswer } from './grokCli.ts';
import { HARNESSES, runCli } from './harness.ts';

/**
 * OpenAI's strict schemas want every property listed as required and no extra properties. A
 * property the app treats as optional is still listed; the model writes null or leaves it out of
 * its reply, and the reply is checked against the app's own schema afterwards.
 */
export function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) out[k] = strictSchema(v);
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as object);
    out.additionalProperties = false;
  }
  return out;
}

export async function codexCliJson<S extends z.ZodType>(opts: {
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
  const search = Boolean(opts.tools?.length);
  const prompt = [
    opts.system,
    search
      ? 'Use web search to find and open pages. Do not read, write or run anything on this computer.'
      : 'Answer from the information given. Do not search and do not use any tools.',
    `Reply with one JSON object and nothing else: no explanation, no code fence. It must match this JSON Schema:\n${JSON.stringify(schema)}`,
    `---\n${opts.user}`,
  ].join('\n\n');

  const dir = mkdtempSync(join(tmpdir(), 'bearok-codex-'));
  const schemaFile = join(dir, 'schema.json');
  const answerFile = join(dir, 'answer.txt');
  writeFileSync(schemaFile, JSON.stringify(strictSchema(schema)));
  const base = [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-C', dir,
    '-o', answerFile,
    '-m', opts.model ?? HARNESSES.codex.defaults.normal!,
  ];
  if (search) base.push('-c', 'web_search="live"');
  try {
    let lastError: unknown;
    // One retry without the schema option, in case Codex turned the schema down: the prompt still asks for the JSON.
    for (let attempt = 0; attempt < 2; attempt++) {
      const args = attempt === 0 ? [...base, '--output-schema', schemaFile, '-'] : [...base, '-'];
      try {
        const stdout = await runCli('codex', args, {
          cwd: dir,
          // The prompt goes in on stdin, so a long student profile never hits the limit on argument length.
          stdin: prompt,
          timeoutMs: opts.timeoutMs ?? config.codexCli.timeoutMs,
          signal: currentSignal(),
          onStopError: () => new StoppedError(),
        });
        let answer = '';
        try {
          answer = readFileSync(answerFile, 'utf8');
        } catch {
          answer = stdout;
        }
        return { data: fullestAnswer(answer, opts.schema), citations: [] };
      } catch (e) {
        lastError = e;
        if (e instanceof StoppedError || (e instanceof Error && /not found|timed out/.test(e.message))) break;
      }
    }
    throw lastError;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
