// One application on the Applications list, with the posting's picture on the left and what
// matters for applying: the deadline, who can apply, what the application asks for, and how much
// of it is written. The title opens its portal. A Saved row (the first stage) is a posting the
// student kept from the feed: it opens its details in place, starts the application, or is removed.
import { ArrowRight, ChevronDown, Clock, FileText, ListChecks, PenLine, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useStore } from '../../../state/StoreProvider.tsx';
import { SavedDetails } from '../SavedDetails.tsx';
import { statusLabel } from '../../../lib/applications.ts';
import { daysLeft, deadlineLabel, progressLabel, type ListApplication } from '../../../lib/portal/list.ts';
import type { TrackedApplication } from '../../../state/live.tsx';
import type { Opportunity } from '../../../types.ts';
import { typeMeta } from '../../meta.ts';
import { Cover } from '../../OpportunityCard.tsx';
import { StatusSelect } from '../../StatusSelect.tsx';

/** The portal's address for an application. */
export const portalPath = (opportunityId: string) => `/applications/${encodeURIComponent(opportunityId)}`;

/** "3 questions, résumé, transcript": what the application asks for, as far as is known. */
export function needsLabel(prompts: string[], materials: string[]): string | null {
  const parts = [prompts.length ? `${prompts.length} ${prompts.length === 1 ? 'question' : 'questions'}` : null, ...materials.map((m) => m.toLowerCase())].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export function ApplicationListRow({
  application: a,
  posting,
  tracked,
  now = Date.now(),
}: {
  application: ListApplication;
  /** The posting behind it; absent for one the student made themselves. */
  posting?: Opportunity;
  tracked?: TrackedApplication;
  now?: number;
}) {
  const meta = a.kind && a.kind !== 'custom' ? typeMeta[a.kind] : null;
  const Icon = meta?.icon ?? (a.kind === 'custom' ? PenLine : FileText);
  const days = daysLeft(a.deadline, now);
  // Only an application still to send can be late or urgent.
  const tone = a.status === 'applied' ? 'quiet' : days === null ? 'none' : days < 0 ? 'passed' : days <= 7 ? 'soon' : 'later';
  const share = a.progress.total === 0 ? 0 : Math.round((a.progress.done / a.progress.total) * 100);
  const needs = needsLabel(tracked?.prompts ?? [], tracked?.materials ?? []);
  const who = posting?.eligibility ?? null;
  const saved = a.status === 'interested';
  const [open, setOpen] = useState(false);
  const { state, dispatch } = useStore();
  const navigate = useNavigate();
  // Starting moves it on to To apply (sent to the account by the live layer) and opens its portal.
  const start = () => {
    dispatch({ type: 'setApplication', id: a.opportunityId, status: 'to_apply' });
    navigate(portalPath(a.opportunityId));
  };
  // Removing a Saved row unsaves it: the agents hear it, and an application with nothing written goes.
  const remove = () => {
    if (state.saved.includes(a.opportunityId)) dispatch({ type: 'toggleSaved', id: a.opportunityId });
    else dispatch({ type: 'setApplication', id: a.opportunityId, status: null });
  };

  return (
    <li className="saved-item" data-open={open}>
      <article className="feed-row apl-card" aria-labelledby={`apl-${a.opportunityId}`} data-status={a.status}>
        <div className="feed-row-layout">
        <div className="feed-row-media">
          {posting ? (
            <Cover opportunity={posting} className="absolute inset-0 size-full" />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-slate-100 text-slate-500">
              <PenLine className="size-10" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="feed-row-body">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${meta?.tint ?? 'bg-slate-100 text-slate-600'}`}>
              <Icon className="size-3.5" aria-hidden="true" />
              {meta?.label ?? (a.kind === 'custom' ? 'Made by you' : 'Application')}
            </span>
            <span className="apl-status" data-status={a.status}>
              {statusLabel[a.status]}
            </span>
          </div>
          <h2 id={`apl-${a.opportunityId}`} className="mt-2 line-clamp-2 text-[17px] leading-snug font-semibold text-ink text-balance">
            <Link to={portalPath(a.opportunityId)} className="text-left after:absolute after:inset-0">
              {a.title}
            </Link>
          </h2>
          <p className="mt-0.5 truncate text-sm font-medium text-ink-2">{a.organizer || 'No organizer given'}</p>

          {/* Application details in place of the posting's description. */}
          <dl className="apl-facts">
            <div>
              <dt>
                <Clock className="size-3.5" aria-hidden="true" /> Deadline
              </dt>
              <dd className="apl-due" data-tone={tone}>
                {deadlineLabel(a.deadline, now)}
              </dd>
            </div>
            <div>
              <dt>
                <Users className="size-3.5" aria-hidden="true" /> Who can apply
              </dt>
              <dd className={who ? 'line-clamp-2' : 'text-ink-3'}>{who ?? (a.custom ? 'Not given' : 'The posting does not say')}</dd>
            </div>
            <div>
              <dt>
                <ListChecks className="size-3.5" aria-hidden="true" /> Asks for
              </dt>
              <dd className={needs ? 'line-clamp-2' : 'text-ink-3'}>{needs ?? 'Open it to find the questions'}</dd>
            </div>
          </dl>

          <div className="relative z-10 mt-auto flex flex-wrap items-center gap-3 pt-3">
            <span className="apl-progress">
              <span className="apl-progress-text">{progressLabel(a.progress)}</span>
              <span className="apl-bar" aria-hidden="true">
                <span style={{ width: `${share}%` }} data-full={a.progress.total > 0 && a.progress.done === a.progress.total} />
              </span>
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2 text-sm text-ink-2">
              {/* Status is changed here; one made by the student is changed in its portal. */}
              {!a.custom && <StatusSelect id={a.opportunityId} />}
              {saved && posting && (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${a.opportunityId}-details`}
                  onClick={() => setOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink"
                >
                  Details
                  <ChevronDown className={`size-4 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
                </button>
              )}
              {saved && (
                <button type="button" onClick={remove} aria-label={`Remove ${a.title} from Saved`} title="Remove from Saved" className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-white text-ink-2">
                  <X className="size-4" aria-hidden="true" />
                </button>
              )}
              {saved ? (
                <button type="button" onClick={start} className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white">
                  Start application <ArrowRight className="size-4" aria-hidden="true" />
                </button>
              ) : (
                <Link to={portalPath(a.opportunityId)} className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-white">
                  Open application <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              )}
            </span>
          </div>
        </div>
        </div>
      </article>
      {saved && open && posting && (
        <div id={`${a.opportunityId}-details`}>
          <SavedDetails opportunity={posting} application={tracked} />
        </div>
      )}
    </li>
  );
}
