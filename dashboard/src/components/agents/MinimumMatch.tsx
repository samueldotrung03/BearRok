// The minimum match, in the agent settings: postings the agents score below it are left out of
// the feed. A slider and a number box that move together; the dialog saves it with the rest.
import { useId } from 'react';
import { cleanThreshold, DEFAULT_MATCH_THRESHOLD, thresholdLine } from '../../lib/match.ts';
import '../../styles/match.css';

export function MinimumMatch({ value, onChange, disabled = false }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  const id = useId();
  const set = (raw: unknown) => onChange(cleanThreshold(raw));
  return (
    <section className="ags-section" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-title`}>Minimum match</h3>
        {value !== DEFAULT_MATCH_THRESHOLD && (
          <button type="button" className="mm-reset" onClick={() => onChange(DEFAULT_MATCH_THRESHOLD)} disabled={disabled}>
            Reset to {DEFAULT_MATCH_THRESHOLD}%
          </button>
        )}
      </div>
      <p className="ags-note">
        Your agents score how well each posting matches your profile, from 0 to 100%. Anything fake, closed or past its deadline is dropped whatever it scores.
      </p>
      <div className="mm-row mt-3">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          disabled={disabled}
          className="mm-range"
          style={{ '--mm-fill': `${value}%` } as React.CSSProperties}
          aria-label="Minimum match, percent"
          aria-valuetext={`${value}%`}
          onChange={(e) => set(e.target.value)}
        />
        <label className="mm-box">
          <input type="number" min={0} max={100} step={1} inputMode="numeric" value={value} disabled={disabled} aria-label="Minimum match, percent" onChange={(e) => set(e.target.value)} />
          <span aria-hidden="true">%</span>
        </label>
      </div>
      <p className="mm-line" aria-live="polite">
        {thresholdLine(value)} Applies from the next search; your feed updates when you save.
      </p>
    </section>
  );
}
