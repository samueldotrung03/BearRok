// Every posting the student saved and every application they are working on, from their account,
// as one pipeline: Saved (kept from the feed) → To apply → Applying → Applied. Saving a card puts it
// here at Saved; starting it moves it on. The student can also start one from a saved posting or a
// blank one. Each row opens the application's portal, where its parts are written and uploaded; a
// Saved row opens its details in place. Sheet view shows the same list as a spreadsheet. The old
// Saved page's address lands here (?stage=saved, ?view=sheet). The rules live in src/lib/portal/list.ts.
import { X as XSmall } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApplicationListRow } from '../components/applications/list/ApplicationListRow.tsx';
import { ListToolbar } from '../components/applications/list/ListToolbar.tsx';
import { NewApplicationButton } from '../components/applications/list/NewApplication.tsx';
import { SheetView } from '../components/applications/SheetView.tsx';
import { Card, Page } from '../components/Page.tsx';
import {
  DEFAULT_PREFS,
  dueWithinWeek,
  filterApplications,
  filterExceptStatus,
  mergeApplications,
  normalizePrefs,
  sortApplications,
  stageFromQuery,
  statusCounts,
  type ApplicationRecord,
  type ListPrefs,
} from '../lib/portal/list.ts';
import { useLocal } from '../lib/useLocal.ts';
import { useLive } from '../state/live.tsx';
import { useStore } from '../state/StoreProvider.tsx';
import '../styles/applications.css';

type View = 'list' | 'sheet';

export function Applications() {
  const live = useLive();
  const { state } = useStore();
  const [stored, setStored] = useLocal<ListPrefs>('bearrok.applications.list', DEFAULT_PREFS);
  const prefs = normalizePrefs(stored);
  const setPrefs = (next: Partial<ListPrefs>) => setStored((current) => ({ ...normalizePrefs(current), ...next }));
  const [query, setQuery] = useState('');
  // A link to a stage (the dock's old Saved entry, a Saved count elsewhere) or to Sheet view.
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>(params.get('view') === 'sheet' ? 'sheet' : 'list');
  useEffect(() => {
    const stage = stageFromQuery(params.get('stage'));
    if (stage) setPrefs({ status: stage });
    if (params.get('view') === 'sheet') setView('sheet');
    // The address is read once; it then shows plain /applications so a reload keeps the choice made here.
    if (params.has('stage') || params.has('view')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const [records, setRecords] = useState<ApplicationRecord[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // The full records (title, custom flag, portal progress) are read when the page opens and again
  // whenever the account's applications change, so one made or moved elsewhere shows up.
  const changeKey = JSON.stringify(Object.values(live.applications).map((a) => [a.opportunityId, a.status, a.deadline]));
  useEffect(() => {
    if (live.status !== 'connected') return;
    let cancelled = false;
    void live
      .request('/applications')
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { applications?: ApplicationRecord[] };
        if (cancelled) return;
        setRecords(body.applications ?? []);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changeKey, live.status]);

  // The public showcase shows the sample student's applications instead of saying they cannot be reached.
  const unreachable = live.status === 'offline';
  const offline = unreachable && !live.sample;
  const all = useMemo(
    () => (offline ? [] : mergeApplications(live.applications, records, [...live.savedCards, ...live.opportunities], state.saved)),
    [offline, live.applications, records, live.savedCards, live.opportunities, state.saved],
  );
  // The posting behind each application, for its picture and who can apply.
  const postingsById = useMemo(() => new Map([...live.opportunities, ...live.savedCards].map((o) => [o.id, o])), [live.opportunities, live.savedCards]);
  // Waiting for the account, or for the first read of the records while the stream already has some.
  const loading = live.status === 'connecting' || (live.status === 'connected' && records === null && !loadFailed);

  const now = Date.now();
  const others = { kind: prefs.kind, query, dueSoon: prefs.dueSoon };
  const counts = statusCounts(filterExceptStatus(all, others, now));
  const dueSoonCount = filterApplications(all, { ...others, status: prefs.status, dueSoon: true }, now).length;
  const shown = sortApplications(filterApplications(all, { ...others, status: prefs.status }, now), prefs.sort);

  const active = all.filter((a) => a.status === 'to_apply' || a.status === 'applying');
  const savedCount = all.filter((a) => a.status === 'interested').length;
  const dueThisWeek = active.filter((a) => dueWithinWeek(a, now)).length;
  const subtitle =
    all.length === 0
      ? 'What you save and everything you apply to, in one place.'
      : `${savedCount} saved, ${active.length} in progress${dueThisWeek ? `, ${dueThisWeek} due this week` : ''}. Start a saved one when you are ready to apply.`;

  const clearFilters = () => {
    setQuery('');
    setPrefs({ status: 'all', kind: 'all', dueSoon: false });
  };

  // The Google Sheet is read again whenever what is saved, or where it stands, changes.
  const sheetKey = JSON.stringify([state.saved, Object.entries(live.applications).map(([id, a]) => [id, a.status, a.deadline, a.calendar.state])]);

  return (
    <Page
      title="Applications"
      subtitle={subtitle}
      aside={
        <div className="flex flex-wrap items-center gap-2">
          <div className="saved-tabs" role="tablist" aria-label="Applications views">
            {(['list', 'sheet'] as View[]).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)} className="saved-tab">
                {value === 'list' ? 'List' : 'Sheet view'}
              </button>
            ))}
          </div>
          <NewApplicationButton disabled={unreachable} />
        </div>
      }
    >
      {view === 'sheet' ? (
        <SheetView refreshKey={sheetKey} />
      ) : offline ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-semibold">Your applications cannot be reached</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            They are kept with your account, and the app cannot reach it right now. They show here again once it can; nothing you wrote is lost.
          </p>
        </Card>
      ) : all.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-semibold">{loading ? 'Loading your applications…' : 'No applications yet'}</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
            Save a card in the feed and it is kept here as Saved; saving also tells the agents to look for more like it. You can also start a blank application for
            anything else.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <NewApplicationButton variant="solid" />
            <Link to="/" className="inline-flex h-10 items-center rounded-xl border border-line bg-white px-4 text-sm font-semibold text-ink">
              Go to the feed
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <ListToolbar prefs={prefs} onPrefs={setPrefs} query={query} onQuery={setQuery} counts={counts} dueSoonCount={dueSoonCount} />
          {loadFailed && (
            <p className="mt-3 rounded-xl bg-white/85 px-4 py-2.5 text-sm text-orange-700 shadow-card">
              Progress and the applications you made yourself could not be loaded just now. They show again when the app can reach your account.
            </p>
          )}
          {shown.length === 0 ? (
            <Card className="mt-4 p-8 text-center">
              <p className="font-semibold">Nothing matches</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-ink-2">
                {prefs.status === 'saved' && !query && prefs.kind === 'all' && !prefs.dueSoon ? 'Nothing saved yet. Save a card in the feed and it shows here.' : 'Try fewer words, another kind or another stage.'}
              </p>
              <button type="button" onClick={clearFilters} className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-white px-4 text-sm font-semibold">
                <XSmall className="size-4" aria-hidden="true" /> Show everything
              </button>
            </Card>
          ) : (
            <ul className="mt-4 flex flex-col gap-3.5" aria-label="Applications">
              {shown.map((a) => (
                <ApplicationListRow key={a.opportunityId} application={a} posting={postingsById.get(a.opportunityId)} tracked={live.applications[a.opportunityId]} now={now} />
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}
