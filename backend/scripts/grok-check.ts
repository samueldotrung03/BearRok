// Opt-in live call. `npm test` does not run this and stays on simulated agents.
// Run: npm run grok:check
// One small live call to confirm the key, the model name and web search all work on this account.
import { z } from 'zod';
import { config } from '../src/config.ts';
import { grokJson } from '../src/grok.ts';
import { transport } from '../src/harness.ts';

if (transport() === null) {
  console.error('No model is connected. Connect Claude, ChatGPT or Grok in Settings, or set GROK_TRANSPORT in backend/.env.');
  process.exit(1);
}
console.log(`transport: ${transport()}`);
const started = Date.now();
const { data, citations } = await grokJson({
  name: 'check',
  system: 'Use web search. Answer from what you find.',
  user: 'Find one hackathon listed on devpost.com that is open for registration right now.',
  schema: z.object({ title: z.string(), url: z.string(), quote: z.string() }),
  tools: [{ type: 'web_search' }],
});
console.log(`answered in ${Date.now() - started} ms`);
console.log(data);
console.log(`${citations.length} citation(s)`, citations.slice(0, 5));
