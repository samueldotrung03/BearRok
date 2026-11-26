// The Claude harness: the agents on Claude through the Claude Code CLI (`claude -p`), on the
// Claude account signed in on this computer.
//
// Same job as grok.ts and grokCli.ts: send one prompt, get one JSON answer back.
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { currentSignal, StoppedError } from './agents/stop.ts';
import { config } from './config.ts';
import type { GrokResult, GrokTool } from './grok.ts';
import { extractJson } from './grokCli.ts';
import { HARNESSES, runCli } from './harness.ts';

/** An empty folder to run in, so the CLI has no project files, settings or memory in reach. */
function sandboxDir(): string {
  const dir = join(tmpdir(), 'bearok-claude-cli');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// API keys are dropped by runCli (harness.ts), so the CLI can only use the Claude subscription
// signed in on this computer; so are the settings of any Claude Code session the backend came from.
const run = (args: string[], timeoutMs: number) =>
  runCli('claude', args, { cwd: sandboxDir(), timeoutMs, signal: currentSignal(), okOnJson: true, onStopError: () => new StoppedError() });

export async function claudeCliJson<S extends z.ZodType>(opts: {
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

  const args = [
    '-p', opts.user,
    '--system-prompt', `${opts.system}\n\n${search ? 'Use web search and page fetches to find and open pages. You have no other tools.' : 'Answer from the information given. You have no tools.'}`,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(schema),
    '--model', opts.model ?? HARNESSES.claude.defaults.normal!,
    // Only the two web tools, or none at all: no shell, no file access.
    '--tools', search ? 'WebSearch,WebFetch' : '',
    // Nothing from this machine's own Claude Code set-up: no settings, hooks, plugins, memory or connectors.
    '--setting-sources', '',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (search) args.push('--allowedTools', 'WebSearch', 'WebFetch');
  if (config.claudeCli.effort) args.push('--effort', config.claudeCli.effort);

  const stdout = await run(args, opts.timeoutMs ?? config.claudeCli.timeoutMs);
  let body: any;
  try {
    body = JSON.parse(stdout);
  } catch {
    throw new Error(`claude CLI returned something that is not JSON: ${stdout.trim().slice(0, 300)}`);
  }
  if (body.is_error || body.subtype !== 'success') throw new Error(`claude CLI: ${String(body.result ?? body.subtype ?? 'failed').slice(0, 300)}`);
  // With --json-schema the validated answer is in structured_output; fall back to reading the text.
  const answer = body.structured_output ?? extractJson(String(body.result ?? ''));
  return { data: opts.schema.parse(answer), citations: [] };
}
