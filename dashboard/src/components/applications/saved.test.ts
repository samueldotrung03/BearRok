// The Saved page, the expanded details of a saved row, and the Applications sheet view, rendered to HTML.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { opportunities } from '../../data/sample.ts';

const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear(), key: () => null, length: 0 },
});

async function wrap(child: ReturnType<typeof createElement>) {
  const { StoreProvider } = await import('../../state/StoreProvider.tsx');
  const { AuthProvider } = await import('../../auth/AuthProvider.tsx');
  const { LiveProvider } = await import('../../state/live.tsx');
  // React marks the joins between pieces of text; they are taken out so sentences read whole.
  return renderToString(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(StoreProvider, null, createElement(LiveProvider, null, child))))).replace(/<!-- -->/g, '');
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// Importing a page pulls in the app shell. Under the suite's two workers the first import takes longer than Vitest's five-second default.
describe('saved details', { timeout: 120_000 }, () => {
  it('shows the deadline with where it was read, and says plainly what the posting did not state', async () => {
    const { SavedDetails } = await import('./SavedDetails.tsx');
    // A posting the sample student is not tracking.
    const o = {
      ...opportunities[0]!,
      id: 'opp-test-listing',
      deadline: inDays(5),
      deadlineSource: 'listing' as const,
      deadlineEvidence: { quote: 'Applications close January 29', url: 'https://career.example.edu/goldwater' },
      eligibility: null,
      actionUrl: 'https://apply.example.org/form',
    };
    const html = await wrap(createElement(SavedDetails, { opportunity: o, application: undefined }));
    expect(html).toContain('5 days left');
    expect(html).toContain('career.example.edu');
    expect(html).toContain('Applications close January 29');
    expect(html).toContain('The posting does not say');
    expect(html).toContain('Set it to To apply or Applying and the deadline goes on your Google Calendar');
    expect(html).toContain('href="https://apply.example.org/form"');
    expect(html).toContain('Official page');
  });

  it('offers to add a deadline when none is known, and shows the calendar link once applying', async () => {
    const { SavedDetails } = await import('./SavedDetails.tsx');
    const o = { ...opportunities[0]!, id: 'opp-test-undated', deadline: null };
    const noDeadline = await wrap(createElement(SavedDetails, { opportunity: o, application: undefined }));
    expect(noDeadline).toContain('Not stated on the posting');
    expect(noDeadline).toContain('Add deadline');

    store.set('bearrok.dashboard.v3', JSON.stringify({ applications: { [o.id]: { status: 'applying', drafts: {}, materialsDone: [] } } }));
    const application = {
      opportunityId: o.id,
      status: 'applying' as const,
      deadline: inDays(9),
      actionUrl: null,
      prompts: ['Why us?'],
      materials: ['Résumé'],
      reminders: [{ at: inDays(2), label: 'Due in one week' }],
      needsDeadline: false,
      calendar: { state: 'link' as const, eventId: null, htmlLink: null, addUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE', error: null },
    };
    const applying = await wrap(createElement(SavedDetails, { opportunity: { ...o, deadline: application.deadline }, application }));
    // No link to add it by hand: BearRok adds it once Google Calendar is connected.
    expect(applying).not.toContain('Add to Google Calendar');
    expect(applying).toContain('connect Google Calendar and BearRok adds it');
    expect(applying).toContain('Reminders:');
    expect(applying).toContain('Needs: Résumé');
    expect(applying).toContain('1 question on the form');
    store.clear();
  });
});

describe('saved page', { timeout: 120_000 }, () => {
  it('is the Saved list, with no sheet tab, even when an old sheet address is opened', async () => {
    const { Saved } = await import('../../pages/Saved.tsx');
    const html = renderToString(
      createElement(MemoryRouter, { initialEntries: ['/saved?view=sheet'] }, createElement((await import('../../auth/AuthProvider.tsx')).AuthProvider, null,
        createElement((await import('../../state/StoreProvider.tsx')).StoreProvider, null, createElement((await import('../../state/live.tsx')).LiveProvider, null, createElement(Saved))))),
    );
    expect(html).toContain('Saved');
    expect(html).toContain('Search what you saved');
    expect(html).not.toContain('Sheet view');
    expect(html).not.toContain('aria-label="Applications spreadsheet"');
  });
});

describe('applications page', { timeout: 120_000 }, () => {
  it('has the List and Sheet view tabs, and no Saved stage', async () => {
    const { Applications } = await import('../../pages/Applications.tsx');
    const html = await wrap(createElement(Applications));
    expect(html).toContain('aria-label="Applications views"');
    expect(html).toContain('>List<');
    expect(html).toContain('>Sheet view<');
    expect(html).not.toContain('>Saved<');
  });

  it('opens Sheet view from the old Saved page address', async () => {
    const { Applications } = await import('../../pages/Applications.tsx');
    const html = renderToString(
      createElement(MemoryRouter, { initialEntries: ['/applications?view=sheet'] }, createElement((await import('../../auth/AuthProvider.tsx')).AuthProvider, null,
        createElement((await import('../../state/StoreProvider.tsx')).StoreProvider, null, createElement((await import('../../state/live.tsx')).LiveProvider, null, createElement(Applications))))),
    );
    expect(html).toContain('aria-label="Applications spreadsheet"');
  });
});

describe('sheet view', { timeout: 120_000 }, () => {
  it('is always a spreadsheet: every column is set and blank rows wait to be filled, even with nothing loaded', async () => {
    const { SheetView, SHEET_COLUMNS } = await import('./SheetView.tsx');
    const html = await wrap(createElement(SheetView, { refreshKey: 'x' }));
    for (const column of SHEET_COLUMNS) expect(html).toContain(`<th scope="col" data-column="${column}">${column}</th>`);
    expect(html.match(/class="saved-sheet-blank"/g)?.length).toBe(14);
    expect(html).toContain('Loading your applications');
    // Google is not connected, so the sheet says where to connect it rather than offering to make one.
    expect(html).toContain('Connect Google in Settings to keep a copy in your own Drive');
    expect(html).not.toContain('Create Google Sheet');
  });

  it('has the same columns as the sheet the backend writes', async () => {
    const { SHEET_COLUMNS } = await import('./SheetView.tsx');
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../../../backend/src/sheets.ts', import.meta.url), 'utf8');
    const block = /TRACKER_HEADER = \[([\s\S]*?)\];/.exec(source)![1]!;
    expect([...block.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(SHEET_COLUMNS);
  });
});

describe('empty kinds', { timeout: 120_000 }, () => {
  it('an empty kind says so and offers to search for more of it', async () => {
    const { EmptyKind } = await import('../../pages/Feed.tsx');
    const html = await wrap(createElement(EmptyKind, { type: 'research', searching: false, onSearch: () => {} }));
    expect(html).toContain('No research yet');
    expect(html).toContain('Search for more research');
  });
});

describe('status and sheet updates', { timeout: 120_000 }, () => {
  it('saving a card does not create an application, and the status menu defaults to Interested', async () => {
    const { reducer } = await import('../../state/store.ts');
    const { initialState } = await import('../../data/sample.ts');
    const fresh = { ...initialState, saved: [], applications: {} };
    const saved = reducer(fresh, { type: 'toggleSaved', id: 'x' });
    expect(saved.saved).toEqual(['x']);
    expect(saved.applications.x).toBeUndefined();
    const interested = reducer(saved, { type: 'setApplication', id: 'x', status: 'interested' });
    expect(reducer(interested, { type: 'toggleSaved', id: 'x' }).applications.x).toBeUndefined();

    const { StatusSelect } = await import('../StatusSelect.tsx');
    const html = await wrap(createElement(StatusSelect, { id: 'not-saved' }));
    expect(html).not.toMatch(/not tracking/i);
    expect(html).toContain('<option value="interested" selected="">Interested</option>');
    expect(html).toContain('To apply');
    expect(html).toContain('Applying');
    expect(html).toContain('Applied');
  });

  it('the sheet has no update button: a created Google Sheet updates on its own', async () => {
    const { SheetView } = await import('./SheetView.tsx');
    const html = await wrap(createElement(SheetView, { refreshKey: 'x' }));
    expect(html).not.toMatch(/update now/i);
  });
});

describe('feed on launch', { timeout: 120_000 }, () => {
  it('says it is loading, not that there is nothing, before the student’s data has arrived', async () => {
    const { Feed } = await import('../../pages/Feed.tsx');
    const html = await wrap(createElement(Feed));
    expect(html).toContain('Loading your feed');
    expect(html).not.toContain('Nothing here yet');
    expect(html).not.toContain('You are all caught up');
  });

  it('does not let the browser hold the end card in view as cards arrive above it', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.reel-scroller \{[^}]*overflow-anchor: none/);
  });
});
