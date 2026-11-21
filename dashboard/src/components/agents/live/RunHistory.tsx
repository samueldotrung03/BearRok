// History under the live view: a brief report of each of the last runs, newest first, five at a
// time (Show more: up to ten), filtered by day, each expandable to every agent's outcome.
// Figma: RunReportRow (4:166) and S2 History states.
import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ActivityStatus } from '../../../lib/activity/useActivity.ts';
import type { RunReport } from '../../../lib/activity/types.ts';
import { dayLabel, failureLine, formatDuration, funnelSteps, historyDays, LEVEL_SHORT, OUTCOME_WORD, outlineLine, STATUS_WORD, visibleHistory, whenText } from '../../../lib/activity/view.ts';
import { Card } from '../../Page.tsx';

const keyOf = (r: RunReport) => `${r.id}@${r.startedAt}`;

function Metric({ value, label }: { value: number | null; label: string }) {
  return (
    <span className="ag-hist-metric">
      <span className="tabular-nums text-ink">{value ?? '—'}</span>
      <span>{label}</span>
    </span>
  );
}

function ReportRow({ report, open, onToggle, fresh }: { report: RunReport; open: boolean; onToggle: () => void; fresh: boolean }) {
  const panel = useId();
  const warning = report.outlineOnly ? null : failureLine(report);
  const header = (
    <>
      <span className="ag-hist-when">
        <span className="font-medium text-ink">{whenText(report.startedAt)}</span>
        <span>
          Run #{report.number} · {report.triggerText}
        </span>
      </span>
      <span className="ag-hist-request">
        <span className="ag-hist-request-text">{report.request ?? 'Request not recorded'}</span>
        <span className="ag-hist-note" data-tone={report.outlineOnly ? 'quiet' : warning ? 'warn' : 'quiet'}>
          {report.outlineOnly ? outlineLine(report) : (warning ?? 'Nothing failed.')}
        </span>
      </span>
      <span className="ag-hist-metrics">
        <Metric value={report.agents?.total ?? null} label="agents" />
        <Metric value={report.results.found} label="found" />
        <Metric value={report.results.validated} label="validated" />
        <Metric value={report.results.saved} label="saved" />
      </span>
      <span className="ag-hist-duration tabular-nums">{formatDuration(report.durationMs)}</span>
      <span className="ag-hist-pill" data-outcome={report.outcome}>
        {OUTCOME_WORD[report.outcome]}
      </span>
    </>
  );
  return (
    <li className="ag-hist-row" data-open={open} data-fresh={fresh}>
      {report.outlineOnly ? (
        <div className="ag-hist-head">
          {header}
          <span className="size-4" aria-hidden="true" />
        </div>
      ) : (
        <button type="button" className="ag-hist-head" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
          {header}
          <ChevronDown className="ag-hist-chevron size-4" aria-hidden="true" />
        </button>
      )}
      {open && !report.outlineOnly && (
        <div id={panel} className="ag-hist-outcomes">
          {report.failures && report.failures.reasons.length > 0 && (
            <p className="ag-hist-reasons">
              <span className="ag-hist-caption">Why agents failed</span>
              {report.failures.reasons.map((r) => `${r.reason}${r.count > 1 ? ` (×${r.count})` : ''}`).join(' · ')}
            </p>
          )}
          {report.funnel && (
            <div className="ag-hist-reasons">
              <p className="ag-hist-caption">Where postings dropped</p>
              <ol className="ag-hist-funnel">
                {funnelSteps(report.funnel).map((s) => (
                  <li key={s.label}>
                    <span className="ag-hist-level">{s.label}</span>
                    <span>
                      <span className="tabular-nums text-ink">{s.value}</span> {s.unit}
                    </span>
                    <span className="ag-hist-text">{s.notes.join(' · ')}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <p className="ag-hist-caption">Agents, failures first</p>
          <ul>
            {report.outcomes.map((o) => (
              <li key={o.id} className="ag-hist-outcome">
                <span className="ag-hist-level">{LEVEL_SHORT[o.level]}</span>
                <span className="ag-hist-name">
                  {o.name} · {o.task}
                </span>
                <span className="ag-hist-status" data-status={o.status}>
                  {STATUS_WORD[o.status]}
                </span>
                <span className="ag-hist-text">{o.outcome ?? '—'}</span>
                <span className="tabular-nums">{formatDuration(o.durationMs)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function RunHistory({ history, status, onRetry }: { history: RunReport[]; status: ActivityStatus; onRetry: () => void }) {
  const [day, setDay] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Runs present on first render do not animate in; a run that arrives later does.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && history.length) seen.current = new Set(history.map(keyOf));
  useEffect(() => {
    const t = window.setTimeout(() => history.forEach((r) => seen.current?.add(keyOf(r))), 400);
    return () => window.clearTimeout(t);
  }, [history]);

  const days = historyDays(history);
  const { shown, total, canShowMore } = visibleHistory(history, day, more);
  const loading = status === 'connecting' && !history.length;
  const failed = (status === 'error' || status === 'offline') && !history.length;
  const toggle = (k: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <Card className="ag-hist mt-6 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-ink">History</h2>
        <span className="flex-1 text-[13px] text-ink-3" aria-live="polite">
          {loading ? 'Loading…' : history.length ? `${shown.length} of ${total} ${total === 1 ? 'run' : 'runs'}` : failed ? '' : 'No runs yet'}
        </span>
        <label className="ag-hist-filter">
          <span className="sr-only">Show runs from</span>
          <select value={day ?? ''} disabled={!history.length} onChange={(e) => setDay(e.target.value || null)}>
            <option value="">All days</option>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
            {day && !days.includes(day) && <option value={day}>{dayLabel(day)}</option>}
          </select>
        </label>
      </div>

      {loading ? (
        <ul className="mt-4 grid gap-3" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="ag-hist-skeleton" />
          ))}
        </ul>
      ) : failed ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="ag-hist-error text-sm">Could not load run history: the agent server did not answer.</p>
          <button type="button" className="ag-hist-btn" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : !history.length ? (
        <p className="mt-3 text-sm text-ink-2">No runs yet. Each finished run is reported here: what was asked, how many agents worked, what they found and why anything failed.</p>
      ) : !shown.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink-2">No runs on {day ? dayLabel(day) : 'this day'}. Pick another day, or show all days.</p>
          <button type="button" className="ag-hist-btn" onClick={() => setDay(null)}>
            Show all days
          </button>
        </div>
      ) : (
        <>
          <ul className="mt-4 grid gap-3">
            {shown.map((r) => (
              <ReportRow key={keyOf(r)} report={r} open={open.has(keyOf(r))} onToggle={() => toggle(keyOf(r))} fresh={!!seen.current && !seen.current.has(keyOf(r))} />
            ))}
          </ul>
          {canShowMore && (
            <button type="button" className="ag-hist-btn mt-4" onClick={() => setMore(true)}>
              Show more (up to 10)
            </button>
          )}
        </>
      )}
    </Card>
  );
}
