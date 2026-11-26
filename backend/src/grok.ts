// Thin client for the xAI Responses API with structured output and server-side search tools.
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { z } from 'zod';
import { throwIfStopped, timeoutOrStop } from './agents/stop.ts';
import { config } from './config.ts';
import { transport } from './harness.ts';
import { BalanceExhaustedError, isBalanceError } from './quota.ts';

export type GrokTool = { type: 'web_search' } | { type: 'x_search' };

export type GrokResult<T> = { data: T; citations: string[] };

export async function grokJson<S extends z.ZodType>(opts: {
  name: string;
  system: string;
  user: string;
  schema: S;
  tools?: GrokTool[];
  /** Model to use for this call. Defaults to XAI_MODEL. */
  model?: string;
  timeoutMs?: number;
  /**
   * How many turns a search may take. When set, the xAI body sends max_turns as that integer.
   * When omitted, the field is not sent. Claude and Codex have no matching flag, so the option
   * is passed through and those clients leave their arguments unchanged.
   */
  maxTurns?: number;
  /**
   * Picture files on this computer for the model to look at (a flyer). Claude reads them with its
   * Read tool, Codex and the xAI API take them as attached images; the Grok CLI cannot see them,
   * so the prompt must still make sense without them.
   */
  images?: string[];
}): Promise<GrokResult<z.infer<S>>> {
  // A stopped search makes no new calls.
  throwIfStopped();
  // Through the harness connected in Settings, else the xAI API when a key is set.
  const via = transport();
  if (via === 'claude') {
    const { claudeCliJson } = await import('./claudeCli.ts');
    return claudeCliJson(opts);
  }
  if (via === 'codex') {
    const { codexCliJson } = await import('./codexCli.ts');
    return codexCliJson(opts);
  }
  if (via === 'grok') {
    const { grokCliJson } = await import('./grokCli.ts');
    return grokCliJson(opts);
  }
  if (via === null || !config.xaiApiKey) throw new Error('No model is connected. Connect Claude, ChatGPT or Grok in Settings.');

  const jsonSchema = z.toJSONSchema(opts.schema) as Record<string, unknown>;
  delete jsonSchema.$schema;

  const res = await fetch(`${config.xaiBaseUrl}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.xaiApiKey}` },
    signal: timeoutOrStop(opts.timeoutMs ?? config.grokTimeoutMs),
    body: JSON.stringify({
      model: opts.model ?? config.xaiModel,
      input: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.images?.length ? [{ type: 'input_text', text: opts.user }, ...opts.images.map(imageInput)] : opts.user },
      ],
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      ...(opts.maxTurns !== undefined ? { max_turns: opts.maxTurns } : {}),
      text: { format: { type: 'json_schema', name: opts.name, schema: jsonSchema, strict: true } },
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    // Out of credit: every later call fails the same way, so the search ends here.
    if (res.status === 402 || isBalanceError(raw)) throw new BalanceExhaustedError();
    throw new Error(`Grok ${res.status}: ${raw.slice(0, 500)}`);
  }

  const body = JSON.parse(raw);
  const text = extractText(body);
  if (!text) throw new Error(`Grok returned no text: ${raw.slice(0, 500)}`);
  return { data: opts.schema.parse(JSON.parse(text)), citations: extractCitations(body) };
}

/** A picture file as an image the xAI API reads. */
function imageInput(file: string) {
  const ext = extname(file).slice(1).toLowerCase();
  const type = ext === 'jpg' ? 'jpeg' : ext;
  return { type: 'input_image', image_url: `data:image/${type};base64,${readFileSync(file).toString('base64')}` };
}

/** Final message text from a Responses API body. */
export function extractText(body: any): string {
  if (typeof body?.output_text === 'string' && body.output_text) return body.output_text;
  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c?.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
    }
  }
  return parts.join('');
}

/** URLs the model cited, from the top-level list and from inline annotations. */
export function extractCitations(body: any): string[] {
  const urls = new Set<string>();
  for (const c of body?.citations ?? []) {
    if (typeof c === 'string') urls.add(c);
    else if (typeof c?.url === 'string') urls.add(c.url);
  }
  for (const item of body?.output ?? []) {
    for (const c of item?.content ?? []) {
      for (const a of c?.annotations ?? []) if (typeof a?.url === 'string') urls.add(a.url);
    }
  }
  return [...urls];
}
