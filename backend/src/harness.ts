// Which model harness the agents run on: the Claude, ChatGPT (Codex) or Grok app for the command
// line, signed in on this computer with the student's own subscription. Never an API key: each
// harness is called with API key settings removed from its environment.
//
// The choice belongs to the computer, not the student, because the command-line apps and their
// sign-ins live on the computer. It is kept in a small file next to the app's other local data
// (in the desktop app, its own folder on that computer), so a copy of BearRok on another device
// starts with nothing connected and finds that device's own command-line apps.
//
// Connecting a harness proves it works: the app is found, then answers one tiny prompt. Only then
// is it marked connected. The agents switch to a newly chosen harness without a restart.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HarnessId = 'claude' | 'codex' | 'grok';
/** The model family the agents are on, as pages name it. "gpt" is ChatGPT through Codex. */
export type Provider = 'claude' | 'gpt' | 'grok' | 'simulated';
export interface ModelChoice {
  id: string;
  label: string;
}

export interface HarnessDef {
  id: HarnessId;
  /** What the student knows it as. */
  name: string;
  /** The app for the command line. */
  cli: string;
  provider: Exclude<Provider, 'simulated'>;
  command: string;
  envBin: string;
  install: string;
  /** The command that signs in, exactly as typed. */
  login: string;
  /** What to do once it runs. */
  loginHint: string;
  models: ModelChoice[];
  /** The model for each tier when the student has not picked one. Undefined: the app's own default. */
  defaults: { normal?: string; low?: string };
  /** Settings that would bill a paid API account instead of the signed-in subscription. */
  apiKeys: RegExp;
}

const env = process.env;

export const HARNESSES: Record<HarnessId, HarnessDef> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    cli: 'Claude Code',
    provider: 'claude',
    command: 'claude',
    envBin: 'CLAUDE_CLI_BIN',
    install: 'curl -fsSL https://claude.ai/install.sh | bash',
    login: 'claude',
    loginHint: 'Then type /login and sign in with your Claude account.',
    // Fable is left out on purpose.
    models: [
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ],
    defaults: { normal: env.CLAUDE_MODEL_NORMAL || 'claude-opus-5-5', low: env.CLAUDE_MODEL_LOW || 'claude-sonnet-5-5' },
    apiKeys: /^(ANTHROPIC_|AWS_BEARER_TOKEN_BEDROCK$|CLAUDECODE$|CLAUDE_CODE_)/,
  },
  codex: {
    id: 'codex',
    name: 'ChatGPT',
    cli: 'Codex',
    provider: 'gpt',
    command: 'codex',
    envBin: 'CODEX_CLI_BIN',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    loginHint: 'Sign in with your ChatGPT account in the browser window it opens.',
    models: [
      { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol' },
      { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
    ],
    defaults: { normal: env.CODEX_MODEL_NORMAL || 'gpt-6.2-sol', low: env.CODEX_MODEL_LOW || 'gpt-6-luna' },
    apiKeys: /^(OPENAI_API_KEY$|CODEX_API_KEY$|AZURE_OPENAI_)/,
  },
  grok: {
    id: 'grok',
    name: 'Grok',
    cli: 'Grok Build',
    provider: 'grok',
    command: 'grok',
    envBin: 'GROK_CLI_BIN',
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    login: 'grok login',
    loginHint: 'Sign in with the account that has your Grok subscription.',
    models: [
      { id: 'grok-4.7', label: 'Grok 4.7' },
      { id: 'grok-4.5', label: 'Grok 4.5' },
      { id: 'grok-4.3', label: 'Grok 4.3' },
    ],
    defaults: { normal: env.GROK_CLI_MODEL_NORMAL || undefined, low: env.GROK_CLI_MODEL_LOW || undefined },
    apiKeys: /^(XAI_API_KEY$)/,
  },
};
export const HARNESS_IDS = Object.keys(HARNESSES) as HarnessId[];
export const isHarnessId = (v: unknown): v is HarnessId => typeof v === 'string' && Object.hasOwn(HARNESSES, v);

const ALIAS: Record<string, string> = { opus: 'Claude Opus', sonnet: 'Claude Sonnet', haiku: 'Claude Haiku' };
/** The harness a model id belongs to, or null for one no harness lists. */
export function harnessOfModel(id: string): HarnessId | null {
  if (ALIAS[id] || id.startsWith('claude-')) return 'claude';
  if (id.startsWith('gpt-')) return 'codex';
  if (id.startsWith('grok-')) return 'grok';
  return null;
}
/** How a model id reads in the app. */
export function modelLabel(id: string | undefined): string {
  if (!id) return "the app's own default";
  for (const h of HARNESS_IDS) {
    const m = HARNESSES[h].models.find((x) => x.id === id);
    if (m) return m.label;
  }
  return ALIAS[id] ?? id;
}

// ---- finding the command-line apps on this computer -----------------------------------------

/**
 * The places these apps are installed on a Mac, Linux or Windows computer. An app opened from the
 * Finder gets a short PATH, so the usual install folders are searched as well.
 */
function searchDirs(): string[] {
  const home = homedir();
  const dirs = [
    ...(env.PATH ?? '').split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.grok', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.yarn', 'bin'),
    join(home, 'Library', 'pnpm'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ];
  if (env.APPDATA) dirs.push(join(env.APPDATA, 'npm'));
  // Node installed through nvm keeps globally installed apps beside each version of node.
  const nvm = join(home, '.nvm', 'versions', 'node');
  try {
    for (const v of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, v, 'bin'));
  } catch {
    // no nvm
  }
  return [...new Set(dirs.filter(Boolean))];
}

function executable(path: string): boolean {
  try {
    accessSync(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where this harness's app for the command line is on this computer, or null. */
export function findBin(id: HarnessId): string | null {
  const def = HARNESSES[id];
  const override = env[def.envBin]?.trim();
  if (override && (override.includes('/') || override.includes('\\'))) return executable(override) ? override : null;
  const name = override || def.command;
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.ps1', ''] : [''];
  for (const dir of searchDirs()) {
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p) && executable(p)) return p;
    }
  }
  return null;
}

/**
 * The environment a harness runs in: no API keys, so it can only use the subscription signed in on
 * this computer, and a PATH that also has the app's own folder (an app installed with npm needs the
 * node beside it) and the usual install folders.
 */
export function cliEnv(id: HarnessId, bin: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!HARNESSES[id].apiKeys.test(k)) out[k] = v;
  out.PATH = [dirname(bin), ...searchDirs()].join(delimiter);
  return out;
}

/** Runs a harness's app once. Used by the clients in claudeCli.ts, codexCli.ts and grokCli.ts. */
export function runCli(
  id: HarnessId,
  args: string[],
  opts: { cwd: string; timeoutMs: number; stdin?: string; signal?: AbortSignal; okOnJson?: boolean; onStopError: () => Error },
): Promise<string> {
  const bin = findBin(id);
  const def = HARNESSES[id];
  if (!bin) return Promise.reject(new Error(`${def.cli} (the ${def.name} app for the command line) was not found on this computer`));
  if (opts.signal?.aborted) return Promise.reject(opts.onStopError());
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: opts.cwd, env: cliEnv(id, bin), stdio: [opts.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' && /\.(cmd|ps1)$/i.test(bin) });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onStop);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => reject(new Error(`${def.command} timed out after ${Math.round(opts.timeoutMs / 1000)}s`)));
    }, opts.timeoutMs);
    // The student stopped the search: end this call now rather than when it finishes.
    const onStop = () => {
      child.kill('SIGKILL');
      finish(() => reject(opts.onStopError()));
    };
    opts.signal?.addEventListener('abort', onStop, { once: true });
    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(opts.stdin);
    }
    child.stdout!.on('data', (d) => (out += d));
    child.stderr!.on('data', (d) => (err += d));
    child.on('error', (e) => finish(() => reject(e)));
    child.on('close', (code) => {
      // Some apps report failures as JSON on stdout with a non-zero exit, so hand that back to be read.
      if (code === 0 || (opts.okOnJson && out.trim().startsWith('{'))) finish(() => resolve(out));
      else finish(() => reject(new Error(`${def.command} exited ${code}: ${(err || out).trim().slice(-400)}`)));
    });
  });
}

// ---- which harnesses are connected, kept on this computer ----------------------------------

interface HarnessState {
  connected: HarnessId[];
  active: HarnessId | null;
}

/** Next to the app's local data. Tests never read or write it. */
const stateFile = (): string | null =>
  env.HARNESS_FILE ?? (env.NODE_TEST_CONTEXT ? null : join(dirname(env.LOCAL_DATA_FILE ?? fileURLToPath(new URL('../.data/store.json', import.meta.url))), 'harness.json'));

function initialState(): HarnessState {
  const file = stateFile();
  if (file) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const connected = (Array.isArray(raw.connected) ? raw.connected : []).filter(isHarnessId) as HarnessId[];
      return { connected, active: isHarnessId(raw.active) && connected.includes(raw.active) ? raw.active : (connected[0] ?? null) };
    } catch {
      // nothing saved yet
    }
  }
  // A developer's .env can name one: GROK_TRANSPORT=claude, codex or cli (Grok).
  if (env.NODE_TEST_CONTEXT) return { connected: [], active: null };
  const named: HarnessId | null = env.GROK_TRANSPORT === 'claude' ? 'claude' : env.GROK_TRANSPORT === 'codex' ? 'codex' : env.GROK_TRANSPORT === 'cli' ? 'grok' : null;
  return named ? { connected: [named], active: named } : { connected: [], active: null };
}

let state: HarnessState = initialState();
const listeners = new Set<() => void>();

function save() {
  const file = stateFile();
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('could not save the harness choice:', e instanceof Error ? e.message : e);
  }
}

function changed() {
  save();
  for (const fn of listeners) fn();
}

/** Called when the agents should move to another harness, or to none. */
export function onHarnessChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const connectedHarnesses = (): HarnessId[] => [...state.connected];
export const activeHarness = (): HarnessId | null => state.active;

export function markConnected(id: HarnessId) {
  if (!state.connected.includes(id)) state = { ...state, connected: [...state.connected, id] };
  if (!state.active) state = { ...state, active: id };
  changed();
}

export function disconnect(id: HarnessId) {
  const connected = state.connected.filter((h) => h !== id);
  state = { connected, active: state.active === id ? (connected[0] ?? null) : state.active };
  changed();
}

export function setActive(id: HarnessId): boolean {
  if (!state.connected.includes(id)) return false;
  if (state.active !== id) {
    state = { ...state, active: id };
    changed();
  }
  return true;
}

/** For tests: start from a given state without touching any file. */
export function setHarnessStateForTest(next: HarnessState) {
  state = { connected: [...next.connected], active: next.active };
  for (const fn of listeners) fn();
}

// ---- what the rest of the backend asks --------------------------------------------------------

/**
 * How model calls are made right now: through a connected harness, else through the xAI API when a
 * key is set (a deployed copy), else not at all and the agents are simulated.
 */
export function transport(): HarnessId | 'api' | null {
  return state.active ?? (env.XAI_API_KEY?.trim() ? 'api' : null);
}

export const liveAvailable = () => transport() !== null;

export function provider(): Provider {
  const t = transport();
  return t === null ? 'simulated' : t === 'api' ? 'grok' : HARNESSES[t].provider;
}

const XAI_MODELS = {
  normal: env.XAI_MODEL_NORMAL ?? 'grok-4.5',
  low: env.XAI_MODEL_LOW ?? 'grok-4.3',
};

/** The model for each tier on the current transport. Undefined: the app's own default. */
export function tierModels(): { normal?: string; low?: string } {
  const t = transport();
  if (t === null || t === 'api') return XAI_MODELS;
  return HARNESSES[t].defaults;
}

/** The models a student can pick per agent group on the current transport. */
export function modelChoices(): ModelChoice[] {
  const t = transport();
  if (t === null) return [];
  return HARNESSES[t === 'api' ? 'grok' : t].models;
}

/** Whether a student's chosen model can be used on the current transport. */
export function fitsTransport(model: string): boolean {
  const t = transport();
  if (t === null) return false;
  return harnessOfModel(model) === (t === 'api' ? 'grok' : t);
}
