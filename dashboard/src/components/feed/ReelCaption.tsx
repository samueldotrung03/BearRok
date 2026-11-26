// The caption along the bottom of a For You card: the kind of opportunity and any chips the page
// adds (match, why it was ranked, "Why this?"), the organizer, why it fits, and where and when.
// Shared by the reel and the opportunity's window, which shows the whole card exactly as the reel does.
import { CalendarBlank, Clock, MapPin, Sparkle } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { daysUntil, dueLabel, shortDate } from '../../lib/time.ts';
import type { Opportunity } from '../../types.ts';
import { formatLabel, typeMeta } from '../meta.ts';

export function ReelCaption({ opportunity: o, chips }: { opportunity: Opportunity; chips?: ReactNode }) {
  const meta = typeMeta[o.type];
  const place = [o.format ? formatLabel[o.format] : null, o.location].filter(Boolean).join(' · ');
  const urgent = o.deadline !== null && daysUntil(o.deadline) <= 7;
  return (
    <div className="reel-body">
      <ul className="flex flex-wrap gap-1.5">
        <li className="reel-chip reel-chip-solid">
          <meta.icon className="size-3.5" aria-hidden="true" />
          {meta.label}
        </li>
        {chips}
      </ul>

      <p className="mt-3 text-[15px] font-semibold text-white">{o.organizer}</p>

      <p className="mt-1.5 flex gap-2 text-sm leading-relaxed text-white/90">
        <Sparkle weight="fill" className="mt-1 size-3.5 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">{o.fitExplanation}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium text-white/85">
        {place && (
          <span className="flex items-center gap-1.5">
            <MapPin weight="fill" className="size-3.5" aria-hidden="true" />
            {place}
          </span>
        )}
        {o.startTime && (
          <span className="flex items-center gap-1.5">
            <CalendarBlank weight="fill" className="size-3.5" aria-hidden="true" />
            Starts {shortDate(o.startTime)}
          </span>
        )}
        {o.deadline && (
          <span className={`flex items-center gap-1.5 ${urgent ? 'rounded-full bg-orange-600 px-2 py-0.5 text-white' : ''}`}>
            <Clock weight="fill" className="size-3.5" aria-hidden="true" />
            {dueLabel(o.deadline)}
          </span>
        )}
      </div>
    </div>
  );
}
