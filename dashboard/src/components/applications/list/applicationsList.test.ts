import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 },
});

/** A row inside the providers it reads (the saved list, the account, the live data). */
async function inProviders(child: ReturnType<typeof createElement>) {
  const { StoreProvider } = await import('../../../state/StoreProvider.tsx');
  const { AuthProvider } = await import('../../../auth/AuthProvider.tsx');
  const { LiveProvider } = await import('../../../state/live.tsx');
  return renderToString(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(StoreProvider, null, createElement(LiveProvider, null, child))))).replace(/<!-- -->/g, '');
}

// Importing a page pulls in the app shell. Under a full parallel run the first import has been measured at about three minutes, past Vitest's five-second default.
describe('Applications page', { timeout: 300_000 }, () => {
  it('with nothing tracked, says saving a card puts it here and offers New application, with no sample data', async () => {
    const { Applications } = await import('../../../pages/Applications.tsx');
    const { StoreProvider } = await import('../../../state/StoreProvider.tsx');
    const { AuthProvider } = await import('../../../auth/AuthProvider.tsx');
    const { LiveProvider } = await import('../../../state/live.tsx');
    const html = renderToString(
      createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(StoreProvider, null, createElement(LiveProvider, null, createElement(Applications))))),
    );
    expect(html).toContain('New application');
    expect(html).toContain('Save a card in the feed and it is kept here as Saved');
    expect(html).toContain('saving also tells the agents to look for more like it');
    // Saved is a stage here now, so nothing links to the old page.
    expect(html).not.toContain('href="/saved"');
    expect(html).toContain('Go to the feed');
    // The old page's sample-driven parts are gone.
    expect(html).not.toContain('Export all deadlines');
  });
});

describe('application row', { timeout: 300_000 }, () => {
  it('links into the portal and shows status, days left, progress and the custom label', async () => {
    const { ApplicationListRow } = await import('./ApplicationListRow.tsx');
    const now = Date.parse('2026-11-19T12:00:00Z');
    const html = await inProviders(
      createElement(ApplicationListRow, {
          now,
          application: {
            opportunityId: 'custom-abc 1',
            title: 'Summer research',
            organizer: 'Physics lab',
            status: 'applying',
            deadline: new Date(now + 4 * 86_400_000).toISOString(),
            actionUrl: null,
            custom: true,
            updatedAt: '',
            progress: { done: 3, total: 7 },
            kind: 'custom',
          },
        }),
    );
    expect(html).toContain('href="/applications/custom-abc%201"');
    expect(html).toContain('Summer research');
    expect(html).toContain('Applying');
    expect(html).toContain('4 days left');
    expect(html).toContain('3 of 7 parts done');
    expect(html).toContain('Made by you');
  });

  it('a posting row keeps its picture and shows the deadline, who can apply and what it asks for instead of the description', async () => {
    const { ApplicationListRow } = await import('./ApplicationListRow.tsx');
    const { StoreProvider } = await import('../../../state/StoreProvider.tsx');
    const { AuthProvider } = await import('../../../auth/AuthProvider.tsx');
    const { opportunities } = await import('../../../data/sample.ts');
    const now = Date.parse('2026-11-19T12:00:00Z');
    const posting = { ...opportunities[0]!, id: 'p1', image: 'https://example.org/event.jpg', eligibility: 'Undergraduates in any major', fitExplanation: 'DESCRIPTION TEXT' };
    const html = renderToString(
      createElement(
        MemoryRouter,
        null,
        createElement(AuthProvider, null, createElement(
          StoreProvider,
          null,
          createElement(ApplicationListRow, {
            now,
            posting,
            tracked: { opportunityId: 'p1', status: 'to_apply', deadline: null, actionUrl: null, prompts: ['Why us?', 'A project'], materials: ['Resume'], reminders: [], needsDeadline: false, calendar: { state: 'none', eventId: null, htmlLink: null, addUrl: null, error: null } },
            application: { opportunityId: 'p1', title: posting.title, organizer: posting.organizer, status: 'to_apply', deadline: new Date(now + 10 * 86_400_000).toISOString(), actionUrl: null, custom: false, updatedAt: '', progress: { done: 0, total: 3 }, kind: posting.type },
          }),
        )),
      ),
    );
    expect(html).toContain('feed-row');
    expect(html).toContain('https://example.org/event.jpg');
    expect(html).toContain('Who can apply');
    expect(html).toContain('Undergraduates in any major');
    expect(html).toContain('2 questions, resume');
    expect(html).toContain('10 days left');
    expect(html).not.toContain('DESCRIPTION TEXT');
    // An application under way opens its portal, and has none of a Saved row's buttons.
    expect(html).not.toContain('Start application');
  });

  it('a Saved row is the first stage: it starts the application, opens its details in place, or is removed', async () => {
    const { ApplicationListRow } = await import('./ApplicationListRow.tsx');
    const { opportunities } = await import('../../../data/sample.ts');
    const now = Date.parse('2026-11-19T12:00:00Z');
    const posting = { ...opportunities[0]!, id: 'kept-1' };
    const html = await inProviders(
      createElement(ApplicationListRow, {
        now,
        posting,
        application: { opportunityId: 'kept-1', title: posting.title, organizer: posting.organizer, status: 'interested', deadline: null, actionUrl: null, custom: false, updatedAt: '', progress: { done: 0, total: 0 }, kind: posting.type },
      }),
    );
    expect(html).toContain('data-status="interested"');
    expect(html).toContain('>Saved<');
    expect(html).toContain('Start application');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Details');
    expect(html).toContain(`aria-label="Remove ${posting.title.replace(/&/g, '&amp;')} from Saved"`);
    // Only one primary action on the row.
    expect(html.match(/btn-primary/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
