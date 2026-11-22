// Google Calendar and Sheets tokens stay on the server. The dashboard only forgets keys an older
// version left in this browser, and the source must not store or send a Google access token.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { forgetGoogleTokens } from './AuthProvider.tsx';

function storage(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

describe('forgetGoogleTokens', () => {
  it('removes only the old Google token keys and names the ones it removed', () => {
    const box = storage({
      'bearrok.google.demo': 'ya29.left-behind',
      'bearrok.google.uid.access': 'ya29.other',
      'bearrok.dashboard.v3': '{}',
      'bearrok.theme': 'dark',
    });
    expect(forgetGoogleTokens(box).sort()).toEqual(['bearrok.google.demo', 'bearrok.google.uid.access']);
    expect([...box.data.keys()].sort()).toEqual(['bearrok.dashboard.v3', 'bearrok.theme']);
    expect([...box.data.values()].join(' ')).not.toMatch(/ya29/);
  });

  it('returns nothing when this browser has no storage', () => {
    const broken: Pick<Storage, 'length' | 'key' | 'removeItem'> = {
      get length(): number {
        throw new Error('denied');
      },
      key: () => null,
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(forgetGoogleTokens(broken)).toEqual([]);
  });
});

describe('Google tokens stay off the dashboard', () => {
  it('no page stores a Google token key, sends the old token header, or keeps a refresh token', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const hits: string[] = [];
    for (const file of walk(root)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(root.length).replaceAll('\\', '/');
      // Tests may name a token to prove it is absent. AuthProvider names the old key so it can delete it.
      if (rel.endsWith('.test.ts') || rel.endsWith('auth/AuthProvider.tsx')) continue;
      const namesOldKey = text.includes('bearrok.google.');
      if (namesOldKey || text.includes('x-google-access-token') || text.includes('refreshToken') || text.includes('access_token')) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });
});
