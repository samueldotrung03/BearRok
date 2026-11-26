// The Terminal scripts behind Connect Claude, Connect ChatGPT and Connect Grok in the desktop app.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** `bash` on PATH, or Git Bash when that is installed but not on PATH (this Windows machine). */
function bashBin(): string {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter((p): p is string => Boolean(p));
  for (const root of roots) {
    const bash = join(root, 'Git', 'bin', 'bash.exe');
    if (existsSync(bash)) return bash;
  }
  return 'bash';
}

const require = createRequire(import.meta.url);
const { scriptFor, STEPS } = require('../../electron/harnessSetup.cjs') as { scriptFor: (id: string, status: string) => string; STEPS: Record<string, unknown> };

describe('one-click set-up scripts', () => {
  it('cover exactly Claude, ChatGPT and Grok', () => {
    expect(Object.keys(STEPS).sort()).toEqual(['claude', 'codex', 'grok']);
  });

  it('install the app when missing, then sign in through the browser', () => {
    const claude = scriptFor('claude', '/tmp/s');
    expect(claude).toContain('curl -fsSL https://claude.ai/install.sh | bash');
    expect(claude).toContain('claude auth status --json');
    expect(claude).toContain('claude auth login --claudeai');
    const codex = scriptFor('codex', '/tmp/s');
    expect(codex).toContain('npm install -g @openai/codex');
    expect(codex).toContain('open "https://nodejs.org/en/download"');
    expect(codex).toContain('codex login');
    const grok = scriptFor('grok', '/tmp/s');
    expect(grok).toContain('curl -fsSL https://x.ai/cli/install.sh | bash');
    expect(grok).toContain('grok login');
  });

  it('report done or failed to the app, and quote the status path safely', () => {
    const s = scriptFor('claude', "/Users/a b/it's/claude.status");
    expect(s).toContain(`STATUS='/Users/a b/it'\\''s/claude.status'`);
    expect(s).toContain('echo done > "$STATUS"');
    expect(s).toContain('echo "failed: $1" > "$STATUS"');
  });

  it('are valid bash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bearok-setup-'));
    for (const id of Object.keys(STEPS)) {
      const file = join(dir, `${id}.command`);
      writeFileSync(file, scriptFor(id, join(dir, `${id}.status`)));
      expect(spawnSync(bashBin(), ['-n', file]).status, id).toBe(0);
    }
  });
});
