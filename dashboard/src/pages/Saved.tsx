// What the student saved, kept with their account. Not every saved posting needs an application:
// anything saved starts as Interested here, and moves to Applications only when its status is
// To apply, Applying or Applied. A ?view=sheet address from the old combined page is dropped;
// the spreadsheet stays on Applications.
import { ChevronDown, LayoutList, Search, X as XSmall } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { SavedDetails } from '../components/applications/SavedDetails.tsx';
import { typeMeta } from '../components/meta.ts';
import { OpportunityRow } from '../components/OpportunityCard.tsx';
import { Card, Page } from '../components/Page.tsx';
import { StatusSelect } from '../components/StatusSelect.tsx';
import { STATUSES, statusLabel } from '../lib/applications.ts';
import { matchPercent } from '../lib/match.ts';
import { daysUntil } from '../lib/time.ts';
import { useLive } from '../state/live.tsx';
import { useStore } from '../state/StoreProvider.tsx';
import type { ApplicationStatus, Opportunity, OpportunityType } from '../types.ts';
import { EmptyKind } from './Feed.tsx';

type StatusFilter = 'all' | ApplicationStatus;

type Sort = 'deadline' | 'recent' | 'fit';
const sortLabel: Record<Sort, string> = { deadline: 'Soonest deadline', recent: 'Recently saved', fit: 'Best match' };

type Group = 'week' | 'later' | 'none' | 'passed';
const groupLabel: Record<Group, { title: string; note: string }> = {
  week: { title: 'Closing this week', note: 'Due in the next 7 days.' },
  later: { title: 'Coming up', note: 'Due later.' },
  none: { title: 'No deadline given', note: 'The posting states none. Check the official page before you plan around it.' },
  passed: { title: 'Deadline passed', note: 'Kept so you can see what you missed; remove them when you are done.' },
};

const groupOf = (o: Opportunity): Group => {
  if (!o.deadline) return 'none';
  const days = daysUntil(o.deadline);
  return days < 0 ? 'passed' : days <= 7 ? 'week' : 'later';
};

const matchesQuery = (o: Opportunity, query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [o.title, o.organizer, o.location ?? '', ...o.tags].join(' ').toLowerCase();
  return words.every((w) => text.includes(w));
};

export function Saved() {
  const { state, dispatch } = useStore();
  const live = useLive();
  const [type, setType] = useState<OpportunityType | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('deadline');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [open, setOpen] = useState<string[]>([]);
  const [params, setParams] = useSearchParams();
  // The spreadsheet lives on Applications. An old /saved?view=sheet link just shows this list.
  useEffect(() => {
    if (params.has('view')) setParams({}, { replace: true });
  }, [params, setParams]);

  const trackedStatus = (id: string): ApplicationStatus | null => state.applications[id]?.status ?? live.applications[id]?.status ?? null;
  // Saved cards, plus an Interested record that was never in the saved list (older data). Anything
  // at To apply or later stays here only while it is still saved.
  const statusOf = (id: string): ApplicationStatus => trackedStatus(id) ?? 'interested';
  const toggleOpen = (id: string) => setOpen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));

  const saved = useMemo(() => {
    const byId = new Map<string, Opportunity>();
    for (const o of [...live.opportunities, ...live.savedCards]) {
      if (state.dismissed.includes(o.id)) continue;
      const tracked = state.applications[o.id]?.status ?? live.applications[o.id]?.status ?? null;
      if (state.saved.includes(o.id) || tracked === 'interested') byId.set(o.id, o);
    }
    return [...byId.values()];
  }, [live.opportunities, live.savedCards, live.applications, state.saved, state.dismissed, state.applications]);

  const navigate = useNavigate();
  const kinds = Object.keys(typeMeta) as OpportunityType[];
  const searched = saved.filter((o) => matchesQuery(o, query));
  const ofType = searched.filter((o) => type === null || o.type === type);
  const matchesStatus = (o: Opportunity, f: StatusFilter) => f === 'all' || statusOf(o.id) === f;
  const shown = ofType.filter((o) => matchesStatus(o, statusFilter));
  const order = (list: Opportunity[]) => {
    const copy = [...list];
    if (sort === 'recent') copy.sort((a, b) => state.saved.indexOf(b.id) - state.saved.indexOf(a.id));
    else if (sort === 'fit') copy.sort((a, b) => matchPercent(b) - matchPercent(a));
    else copy.sort((a, b) => (a.deadline ? Date.parse(a.deadline) : Infinity) - (b.deadline ? Date.parse(b.deadline) : Infinity));
    return copy;
  };
  const groups: { key: Group | 'all'; items: Opportunity[] }[] =
    sort === 'deadline'
      ? (['week', 'later', 'none', 'passed'] as Group[]).map((key) => ({ key, items: order(shown.filter((o) => groupOf(o) === key)) })).filter((g) => g.items.length > 0)
      : [{ key: 'all', items: order(shown) }];
  const closingSoon = saved.filter((o) => groupOf(o) === 'week').length;

  const subtitle =
    saved.length === 0
      ? 'What you decide to pursue, kept with your account.'
      : `${saved.length} saved${closingSoon ? `, ${closingSoon} closing this week` : ''}. Kept with your account, so every device shows the same.`;

  return (
    <Page title="Saved" subtitle={subtitle}>
      <div className="feed-layout">
        <nav className="feed-cats" aria-label="Categories">
          {([null, ...kinds] as (OpportunityType | null)[]).map((value) => {
            const Icon = value ? typeMeta[value].icon : LayoutList;
            return (
              <button key={value ?? 'all'} type="button" className="feed-cat" aria-pressed={type === value} onClick={() => setType(value)}>
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-left">{value === null ? 'All' : typeMeta[value].plural}</span>
                <span className="feed-cat-count">{searched.filter((o) => value === null || o.type === value).length}</span>
              </button>
            );
          })}
        </nav>

        <div className="feed-column">
          <div className="feed-toolbar">
            <label className="feed-search">
              <Search className="size-[18px] shrink-0 text-ink-3" aria-hidden="true" />
              <span className="sr-only">Search what you saved</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by title, organizer, place or tag" />
            </label>
            <label className="feed-select">
              <span className="sr-only">Application status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                {(['all', ...STATUSES] as StatusFilter[]).map((value) => (
                  <option key={value} value={value}>
                    {value === 'all' ? 'Any status' : statusLabel[value]} ({ofType.filter((o) => matchesStatus(o, value)).length})
                  </option>
                ))}
              </select>
            </label>
            <label className="feed-select">
              <span className="sr-only">Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                {(Object.keys(sortLabel) as Sort[]).map((value) => (
                  <option key={value} value={value}>
                    {sortLabel[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {saved.length === 0 && type === null ? (
            <div className="mt-4">
              <Card className="p-10 text-center">
                <p className="text-lg font-semibold">{live.status === 'connecting' ? 'Loading what you saved…' : 'Nothing saved yet'}</p>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">
                  {live.status === 'offline'
                    ? 'Your saved list is kept with your account. It shows here once the app can reach it again.'
                    : 'Save a card in the feed and it is kept here as Interested. Saving also tells the agents to look for more like it. It is not an application until you set it to To apply.'}
                </p>
                <Link to="/" className="btn-primary mt-6 inline-flex h-10 items-center rounded-xl px-4 text-sm font-medium text-white">
                  Go to the feed
                </Link>
              </Card>
            </div>
          ) : type !== null && !saved.some((o) => o.type === type) ? (
            <div className="feed-list-empty">
              <EmptyKind
                type={type}
                saved
                searching={live.searching}
                onSearch={() => {
                  void live.runNow(type);
                  navigate(`/?view=feed&type=${type}`);
                }}
              />
            </div>
          ) : shown.length === 0 ? (
            <div className="feed-list-empty">
              <div className="reel-end">
                <h2 className="font-display text-3xl leading-tight">Nothing matches</h2>
                <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-ink-2">Try fewer words, another category or another status.</p>
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setType(null);
                    setStatusFilter('all');
                  }}
                  className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-white px-4 text-sm font-semibold"
                >
                  <XSmall className="size-4" aria-hidden="true" /> Show everything saved
                </button>
              </div>
            </div>
          ) : (
            groups.map((g) => (
              <section key={g.key} aria-label={g.key === 'all' ? 'Saved' : groupLabel[g.key].title} className="mt-5 first:mt-4">
                {g.key !== 'all' && (
                  <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 px-1">
                    <h2 className={`text-lg font-semibold ${g.key === 'week' ? 'text-orange-700' : 'text-ink'}`}>
                      {groupLabel[g.key].title} <span className="font-normal text-ink-3">· {g.items.length}</span>
                    </h2>
                    <p className="text-sm text-ink-3">{groupLabel[g.key].note}</p>
                  </div>
                )}
                <ul className="flex flex-col gap-3.5">
                  {g.items.map((o) => (
                    <li key={o.id} className={`saved-item ${groupOf(o) === 'passed' ? 'opacity-70' : ''}`} data-open={open.includes(o.id)}>
                      <OpportunityRow
                        opportunity={o}
                        onDismiss={(x) => dispatch({ type: 'dismiss', id: x.id })}
                        actions={
                          <span className="ml-auto flex flex-wrap items-center gap-2 text-sm text-ink-2">
                            <span className="hidden font-medium sm:inline">Status</span>
                            <StatusSelect id={o.id} />
                            <button
                              type="button"
                              aria-expanded={open.includes(o.id)}
                              aria-controls={`${o.id}-details`}
                              onClick={() => toggleOpen(o.id)}
                              className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink"
                            >
                              Details
                              <ChevronDown className={`size-4 transition ${open.includes(o.id) ? 'rotate-180' : ''}`} aria-hidden="true" />
                            </button>
                          </span>
                        }
                      />
                      {open.includes(o.id) && (
                        <div id={`${o.id}-details`}>
                          <SavedDetails opportunity={o} application={live.applications[o.id]} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </Page>
  );
}
