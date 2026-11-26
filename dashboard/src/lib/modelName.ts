// Who ran the agents or wrote an answer, named for the student. The backend reports a provider
// ("claude", "gpt", "grok") or the way it was reached ("claude", "codex", "grok", "cli", "api").
// Each model is named for what it is: Claude output is never called Grok, and so on.
export type ModelName = 'Claude' | 'ChatGPT' | 'Grok';

export function modelName(source: string | null | undefined): ModelName | null {
  if (source === 'claude') return 'Claude';
  if (source === 'gpt' || source === 'codex') return 'ChatGPT';
  if (source === 'grok' || source === 'cli' || source === 'api') return 'Grok';
  return null;
}
