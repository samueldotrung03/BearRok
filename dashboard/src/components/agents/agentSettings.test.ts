import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 },
});

// Importing a page pulls in the app shell. Under the suite's two workers the first import takes longer than Vitest's five-second default.
describe('agent settings', { timeout: 120_000 }, () => {
  it('opens from a button at the top of the Agents page, and the page no longer offers "Internships only"', async () => {
    const { AgentsLive } = await import('../../pages/Agents.tsx');
    const { StoreProvider } = await import('../../state/StoreProvider.tsx');
    const { AuthProvider } = await import('../../auth/AuthProvider.tsx');
    const { LiveProvider } = await import('../../state/live.tsx');
    const html = renderToString(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(StoreProvider, null, createElement(LiveProvider, null, createElement(AgentsLive))))));
    expect(html).toContain('Agent settings');
    expect(html).not.toContain('Internships only');
  });

  it('with no model connected, the Agents page sends the student to connect one first', async () => {
    const { ConnectFirst } = await import('../../pages/Agents.tsx');
    const html = renderToString(createElement(MemoryRouter, null, createElement(ConnectFirst, { offline: false })));
    expect(html).toContain('Connect a model first');
    expect(html).toContain('href="/settings#models"');
    expect(html).toContain('Claude, ChatGPT or Grok');
  });
});
