// Google Sheets: write the student's applications (Saved first, then To apply, Applying, Applied)
// to a spreadsheet in their own Drive. The access token comes from the backend's lasting Google
// connection for each call; it is never stored here or sent to a page.
import type { Application, Opportunity } from './agents/types.ts';

/** Saved is the first stage of an application (status "interested"); the sheet uses the app's words. */
export const STATUS_LABEL: Record<Application['status'], string> = { interested: 'Saved', to_apply: 'To apply', applying: 'Applying', applied: 'Applied' };
const HEADER = ['Opportunity', 'Organizer', 'Status', 'Deadline', 'Next reminder', 'Apply at', 'Materials', 'Prompts'];

export function sheetRows(applications: Application[]): string[][] {
  return [
    HEADER,
    ...applications.map((a) => [
      a.title,
      a.organizer,
      STATUS_LABEL[a.status],
      a.deadline ? a.deadline.slice(0, 10) : 'Unknown',
      a.reminders[0] ? `${a.reminders[0].at.slice(0, 10)} (${a.reminders[0].label})` : '',
      a.actionUrl ?? '',
      a.materials.join(', '),
      a.prompts.join(' | '),
    ]),
  ];
}

export async function exportApplications(accessToken: string, applications: Application[], today: Date, fetchImpl: typeof fetch = fetch): Promise<{ spreadsheetId: string; url: string }> {
  const cell = (value: string, bold = false) => ({ userEnteredValue: { stringValue: value }, ...(bold ? { userEnteredFormat: { textFormat: { bold: true } } } : {}) });
  const rows = sheetRows(applications);
  const res = await fetchImpl('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      properties: { title: `BearRok applications ${today.toISOString().slice(0, 10)}` },
      sheets: [
        {
          properties: { title: 'Applications', gridProperties: { frozenRowCount: 1 } },
          data: [{ startRow: 0, startColumn: 0, rowData: rows.map((row, i) => ({ values: row.map((v) => cell(v, i === 0)) })) }],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Google Sheets ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string };
  return { spreadsheetId: body.spreadsheetId, url: body.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${body.spreadsheetId}` };
}

// ---- the Saved tracker: every saved posting with its details and links, in one sheet ----------


/** One row's worth: the posting, where the student stands on it, and when they saved it. */
export interface TrackerItem {
  opportunity: Opportunity | null;
  application: Application | null;
  savedAt: string | null;
}

export const TRACKER_HEADER = [
  'Opportunity',
  'Organizer',
  'Type',
  'Status',
  'Deadline',
  'Days left',
  'Deadline from',
  'Starts',
  'Format',
  'Location',
  'Who can apply',
  'Apply link',
  'Official page',
  'Materials needed',
  'Application questions',
  'Calendar',
  'Next reminder',
  'Saved on',
  'Fit',
];

const TYPE_LABEL: Record<string, string> = { internship: 'Internship', event: 'Event', club: 'Club', hackathon: 'Hackathon', research: 'Research', scholarship: 'Scholarship' };
const FORMAT_LABEL: Record<string, string> = { online: 'Online', in_person: 'In person', hybrid: 'Hybrid' };

/** The tracker as rows of text, header first. The same rows feed the app's sheet and the Google Sheet. */
export function trackerRows(items: TrackerItem[], now: Date): string[][] {
  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
  return [
    TRACKER_HEADER,
    ...items.map(({ opportunity: o, application: a, savedAt }) => {
      const deadline = a?.deadline ?? o?.deadline ?? null;
      const days = deadline ? Math.ceil((Date.parse(deadline) - now.getTime()) / 86_400_000) : null;
      const source = deadline ? (o?.deadlineSource === 'listing' ? `Another listing: ${o.evidence.find((e) => e.field === 'deadline')?.url ?? ''}`.trim() : a && !o?.deadline ? 'Added by you' : "Organizer's page") : '';
      return [
        o?.title ?? a?.title ?? '',
        o?.organizer ?? a?.organizer ?? '',
        o ? (TYPE_LABEL[o.type] ?? o.type) : '',
        STATUS_LABEL[a?.status ?? 'interested'],
        deadline ? day(deadline) : 'Not stated',
        days === null ? '' : days < 0 ? 'Passed' : String(days),
        source,
        day(o?.startTime),
        o?.format ? FORMAT_LABEL[o.format] ?? o.format : '',
        o?.location ?? '',
        o?.eligibility ?? '',
        a?.actionUrl ?? o?.actionUrl ?? o?.sourceUrl ?? '',
        o?.sourceUrl ?? '',
        (a?.materials.length ? a.materials : (o?.application?.materials ?? [])).join(', '),
        (a?.prompts.length ? a.prompts : (o?.application?.prompts ?? [])).join(' | '),
        a?.calendar.state === 'synced' ? (a.calendar.htmlLink ?? 'On Google Calendar') : a && (a.status === 'to_apply' || a.status === 'applying') ? (deadline ? 'Added once Google Calendar is connected' : 'Needs a deadline') : '',
        a?.reminders[0] ? `${day(a.reminders[0].at)} (${a.reminders[0].label})` : '',
        day(savedAt),
        o ? `${Math.round(o.baseScore * 100)}%` : '',
      ];
    }),
  ];
}

/** The tab BearRok writes in a sheet it makes or one the student picks. */
export const SHEET_TAB = 'Applications';
/** Sheets linked before Saved joined Applications were written to this tab; they keep it. */
export const LEGACY_TAB = 'Saved';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

/** A spreadsheet id from what the student pasted: the sheet's address, or the id itself. Null if neither. */
export function parseSheetId(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (fromUrl) return fromUrl[1]!;
  return /^[a-zA-Z0-9_-]{20,}$/.test(text) ? text : null;
}

/** A Sheets error with Google's status kept, so the routes can answer in words. */
const fail = async (res: Response) => Object.assign(new Error(`Google Sheets ${res.status}: ${(await res.text()).slice(0, 200)}`), { status: res.status });

const addTab = (fetchImpl: typeof fetch, headers: Record<string, string>, id: string, title: string) =>
  fetchImpl(`${API}/${id}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] }),
    signal: AbortSignal.timeout(20_000),
  });

/**
 * Open a sheet the student picked, to link it: its name, and the tab BearRok writes, added when it
 * is not there yet. Nothing already in the sheet is changed. A sheet that cannot be opened is an
 * error in words the student can act on.
 */
export async function openSheet(accessToken: string, spreadsheetId: string, fetchImpl: typeof fetch = fetch): Promise<{ spreadsheetId: string; url: string; title: string | null; tab: string }> {
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const id = encodeURIComponent(spreadsheetId);
  const res = await fetchImpl(`${API}/${id}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw Object.assign(new Error('That sheet was not found. Check the link, or create a new sheet.'), { status: 404 });
  if (res.status === 403) throw Object.assign(new Error('The connected Google account cannot open that sheet. Share it with that account, or create a new sheet.'), { status: 403 });
  if (!res.ok) throw await fail(res);
  const body = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string; properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };
  const tabs = (body.sheets ?? []).map((t) => t.properties?.title);
  if (!tabs.includes(SHEET_TAB)) {
    const add = await addTab(fetchImpl, headers, id, SHEET_TAB);
    if (!add.ok) throw await fail(add);
  }
  return { spreadsheetId: body.spreadsheetId, url: body.spreadsheetUrl ?? sheetUrl(body.spreadsheetId), title: body.properties?.title ?? null, tab: SHEET_TAB };
}

/**
 * Write the tracker to the student's linked Google Sheet, replacing what was on its tab, or make a
 * new sheet when none is linked or the linked one was deleted. A linked sheet that lost its tab
 * gets it back. Uses the access token for this call only.
 */
export async function writeTracker(
  accessToken: string,
  linked: { spreadsheetId: string; tab?: string; title?: string | null } | null,
  rows: string[][],
  today: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<{ spreadsheetId: string; url: string; title: string | null; tab: string }> {
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  if (linked) {
    const tab = linked.tab ?? LEGACY_TAB;
    const id = encodeURIComponent(linked.spreadsheetId);
    const write = async (): Promise<Response> => {
      const clear = await fetchImpl(`${API}/${id}/values/${encodeURIComponent(`${tab}!A1:Z`)}:clear`, { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(20_000) });
      if (!clear.ok) return clear;
      const put = await fetchImpl(`${API}/${id}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ values: rows }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!put.ok) throw await fail(put);
      return put;
    };
    let res = await write();
    // 400: the tab was renamed or deleted. It is added back and written, so the student's file stays linked.
    if (res.status === 400) {
      const add = await addTab(fetchImpl, headers, id, tab);
      if (!add.ok) throw await fail(add);
      res = await write();
    }
    if (res.ok) return { spreadsheetId: linked.spreadsheetId, url: sheetUrl(linked.spreadsheetId), title: linked.title ?? null, tab };
    // 404: the sheet was deleted. 403: it belongs to another Google account than the one now
    // connected (the student switched). Either way a new sheet is made below, and Settings shows
    // its name and link, so the change is in plain sight.
    if (res.status !== 404 && res.status !== 403) throw await fail(res);
  }
  const title = `BearRok applications (${today.toISOString().slice(0, 10)})`;
  const cell = (value: string, bold = false) => ({ userEnteredValue: { stringValue: value }, ...(bold ? { userEnteredFormat: { textFormat: { bold: true } } } : {}) });
  const res = await fetchImpl(API, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: { title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } },
          data: [{ startRow: 0, startColumn: 0, rowData: rows.map((row, i) => ({ values: row.map((v) => cell(v, i === 0)) })) }],
        },
      ],
    }),
  });
  if (!res.ok) throw await fail(res);
  const body = (await res.json()) as { spreadsheetId: string; spreadsheetUrl?: string; properties?: { title?: string } };
  return { spreadsheetId: body.spreadsheetId, url: body.spreadsheetUrl ?? sheetUrl(body.spreadsheetId), title: body.properties?.title ?? title, tab: SHEET_TAB };
}
