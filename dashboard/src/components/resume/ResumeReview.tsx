// Step-by-step confirmation of what a résumé reading found. Nothing is saved until the summary.

import { X } from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useReducer, useRef } from 'react';
import type { Preferences } from '../../data/preferences.ts';
import {
  LOW_CONFIDENCE,
  STEPS,
  applyReview,
  blockView,
  canAdvance,
  initialReview,
  listView,
  reviewReducer,
  scalarView,
  type BlockView,
  type DraftEntry,
  type ListView,
  type ReviewAction,
  type ReviewContext,
  type ReviewState,
  type ScalarView,
} from '../../lib/resume/review.ts';
import type { Profile } from '../../types.ts';

export interface ResumeReviewProps {
  ctx: ReviewContext;
  profile: Profile;
  preferences: Preferences;
  onSave: (applied: ReturnType<typeof applyReview>) => void;
  onClose: () => void;
}

/** The dialog. A native modal keeps focus inside until the student leaves. */
export function ResumeReview({ ctx, profile, preferences, onSave, onClose }: ResumeReviewProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, dispatch] = useReducer((current: ReviewState, action: ReviewAction) => reviewReducer(current, action, ctx), ctx, initialReview);
  const told = useRef(false);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!state.closed || told.current) return;
    told.current = true;
    onClose();
  }, [state.closed, onClose]);

  const save = () => {
    const applied = applyReview(state, ctx, { profile, preferences });
    if (applied.empty) onClose();
    else onSave(applied);
  };

  return (
    <dialog
      ref={ref}
      className="rr-dialog"
      aria-labelledby="rr-title"
      onCancel={(event) => {
        event.preventDefault();
        dispatch({ type: 'escape' });
      }}
    >
      <ResumeReviewView state={state} ctx={ctx} profile={profile} preferences={preferences} onAction={dispatch} onSave={save} onClose={() => dispatch({ type: 'confirmDiscard' })} />
    </dialog>
  );
}

export function ResumeReviewView({
  state,
  ctx,
  profile,
  preferences,
  onAction,
  onSave,
  onClose,
}: Omit<ResumeReviewProps, 'onSave'> & { state: ReviewState; onAction: (action: ReviewAction) => void; onSave: () => void }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const step = STEPS[state.step];
  const summary = state.step >= STEPS.length;
  const applied = summary ? applyReview(state, ctx, { profile, preferences }) : null;
  const blocked = !summary && !state.discard && !canAdvance(state, ctx);

  useEffect(() => {
    if (state.discard) keepRef.current?.focus();
    else titleRef.current?.focus();
  }, [state.step, state.discard]);

  return (
    <>
      <div className="rr-head">
        <div>
          <p className="rr-kicker">{summary ? 'Review' : `Step ${state.step + 1} of ${STEPS.length}`}</p>
          <h2 id="rr-title" ref={titleRef} tabIndex={-1} className="rr-title font-display">
            {state.discard ? 'Close without saving?' : summary ? 'Add this to your profile' : step?.title}
          </h2>
        </div>
        <button type="button" className="rr-close" aria-label="Close" onClick={() => onAction({ type: 'escape' })}>
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="rr-body">
        {state.discard ? (
          <div role="alertdialog" aria-labelledby="rr-title" aria-describedby="rr-discard">
            <p id="rr-discard">Nothing from this résumé has been added to your profile.</p>
          </div>
        ) : (
          <>
            <ol className="rr-progress" aria-hidden="true">
              {STEPS.map((item, index) => (
                <li key={item.id} className={index < state.step ? 'is-done' : index === state.step ? 'is-current' : undefined} />
              ))}
            </ol>
            {summary ? (
              applied && applied.lines.length > 0 ? (
                <ul className="rr-summary">
                  {applied.lines.map((line) => (
                    <li key={line.label}>
                      <b>{line.label}</b>
                      <span>{line.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>Your profile stays as it is.</p>
              )
            ) : (
              step && <StepFields state={state} ctx={ctx} step={step} onAction={onAction} />
            )}
          </>
        )}
      </div>
      <div className="rr-foot">
        {state.discard ? (
          <>
            <button ref={keepRef} type="button" className="rr-quiet" onClick={() => onAction({ type: 'escape' })}>
              Keep reviewing
            </button>
            <button type="button" className="rr-primary" onClick={onClose}>
              Discard
            </button>
          </>
        ) : summary ? (
          <>
            <button type="button" className="rr-quiet" onClick={() => onAction({ type: 'back' })}>
              Back
            </button>
            {applied?.empty ? (
              <button type="button" className="rr-primary" onClick={onClose}>
                Close
              </button>
            ) : (
              <button type="button" className="rr-primary" onClick={onSave}>
                Save to my profile
              </button>
            )}
          </>
        ) : (
          <>
            {blocked && <span className="rr-block">Choose which value to keep before continuing.</span>}
            <button type="button" className="rr-quiet" onClick={() => onAction({ type: 'skip' })}>
              Skip this step
            </button>
            <button type="button" className="rr-quiet" onClick={() => onAction({ type: 'back' })} disabled={state.step === 0}>
              Back
            </button>
            <button type="button" className="rr-primary" disabled={blocked} onClick={() => onAction({ type: 'next' })}>
              {state.step === STEPS.length - 1 ? 'Accept and review' : 'Accept and continue'}
            </button>
          </>
        )}
      </div>
    </>
  );
}

function StepFields({ state, ctx, step, onAction }: { state: ReviewState; ctx: ReviewContext; step: (typeof STEPS)[number]; onAction: (action: ReviewAction) => void }) {
  return (
    <div className="rr-fields">
      {step.scalars.map((key) => (
        <ScalarField key={key} view={scalarView(state, ctx, key)} onAction={onAction} />
      ))}
      {step.lists.map((key) => (
        <ListField key={key} view={listView(state, ctx, key)} onAction={onAction} />
      ))}
      {step.blocks.map((key) => (
        <BlockField key={key} view={blockView(state, ctx, key)} onAction={onAction} />
      ))}
    </div>
  );
}

function ScalarField({ view, onAction }: { view: ScalarView; onAction: (action: ReviewAction) => void }) {
  const id = useId();
  return (
    <fieldset className={view.low ? 'rr-field rr-low' : 'rr-field'}>
      <legend>{view.label}</legend>
      {view.status === 'missing' && <p className="rr-note">Not on the résumé</p>}
      {view.low && <span className="rr-flag">Low confidence</span>}
      {view.status === 'same' && <p className="rr-note">Same as your profile</p>}
      {view.status === 'differ' ? (
        <Choice
          name={view.key}
          label={view.label}
          profile={view.profile || 'Empty'}
          resume={view.resume || 'Empty'}
          source={view.choice.source}
          onPick={(source) => onAction({ type: 'pickScalar', key: view.key, source })}
        />
      ) : (
        view.resume && <p className="rr-read">{view.resume}</p>
      )}
      <label className="rr-label" htmlFor={id}>
        Edit {view.label.toLowerCase()}
      </label>
      <input id={id} className="rr-input" value={view.choice.value} onChange={(event) => onAction({ type: 'editScalar', key: view.key, value: event.target.value })} />
      {view.key === 'email' && <p className="rr-note">This does not change the email you sign in with.</p>}
    </fieldset>
  );
}

function ListField({ view, onAction }: { view: ListView; onAction: (action: ReviewAction) => void }) {
  const id = useId();
  return (
    <fieldset className={view.low ? 'rr-field rr-low' : 'rr-field'}>
      <legend>{view.label}</legend>
      {view.status === 'missing' && <p className="rr-note">Not on the résumé</p>}
      {view.low && <span className="rr-flag">Low confidence</span>}
      {view.status === 'same' && <p className="rr-note">Same as your profile</p>}
      {view.status === 'differ' ? (
        <Choice
          name={view.key}
          label={view.label}
          profile={view.profile.join(', ') || 'Empty'}
          resume={view.resume.join(', ') || 'Empty'}
          source={view.choice.source}
          onPick={(source) => onAction({ type: 'pickList', key: view.key, source })}
        />
      ) : (
        view.resume.length > 0 && (
          <ul className="rr-read">
            {view.resume.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )
      )}
      <label className="rr-label" htmlFor={id}>
        Edit {view.label.toLowerCase()}, one per line
      </label>
      <textarea id={id} className="rr-area" rows={Math.min(6, Math.max(2, view.choice.value.length))} value={view.choice.value.join('\n')} onChange={(event) => onAction({ type: 'editList', key: view.key, value: event.target.value.split('\n') })} />
    </fieldset>
  );
}

function BlockField({ view, onAction }: { view: BlockView; onAction: (action: ReviewAction) => void }) {
  const set = (value: DraftEntry[]) => onAction({ type: 'editBlock', key: view.key, value });
  return (
    <fieldset className={view.low ? 'rr-field rr-low' : 'rr-field'}>
      <legend>{view.label}</legend>
      {view.status === 'missing' && <p className="rr-note">Not on the résumé. This part of your profile stays as it is unless you edit it.</p>}
      {view.low && <span className="rr-flag">Low confidence</span>}
      {view.status === 'same' && <p className="rr-note">Same as your profile</p>}
      {view.status === 'differ' && (
        <Choice
          name={view.key}
          label={view.label}
          profile={names(view.profile)}
          resume={names(view.resume)}
          source={view.choice.source}
          onPick={(source) => onAction({ type: 'pickBlock', key: view.key, source })}
        />
      )}
      {view.choice.value.length === 0 && <p className="rr-note">Nothing in this step.</p>}
      {view.choice.value.map((entry, index) => (
        <EntryCard key={entry.id || index} entry={entry} low={entry.confidence > 0 && entry.confidence < LOW_CONFIDENCE} onChange={(next) => set(view.choice.value.map((item, itemIndex) => (itemIndex === index ? next : item)))} />
      ))}
    </fieldset>
  );
}

function EntryCard({ entry, low, onChange }: { entry: DraftEntry; low: boolean; onChange: (next: DraftEntry) => void }) {
  const id = useId();
  const set = (patch: Partial<DraftEntry>) => onChange({ ...entry, ...patch });
  return (
    <div className={low ? 'rr-entry rr-low' : 'rr-entry'}>
      <div className="rr-entry-grid">
        <label className="rr-label" htmlFor={`${id}-role`}>
          Role
          <input id={`${id}-role`} className="rr-input" value={entry.role} onChange={(event) => set({ role: event.target.value })} />
        </label>
        <label className="rr-label" htmlFor={`${id}-org`}>
          Organization
          <input id={`${id}-org`} className="rr-input" value={entry.organization} onChange={(event) => set({ organization: event.target.value })} />
        </label>
        <p className="rr-note is-wide">
          {[entry.kind, entry.location, entry.start && `${entry.start}${entry.current ? ' to now' : entry.end ? ` to ${entry.end}` : ''}`].filter(Boolean).join(' · ')}
        </p>
        <label className="rr-label is-wide" htmlFor={`${id}-sum`}>
          Summary
          <textarea id={`${id}-sum`} className="rr-area" rows={3} value={entry.summary} onChange={(event) => set({ summary: event.target.value })} />
        </label>
      </div>
    </div>
  );
}

function Choice({ name, label, profile, resume, source, onPick }: { name: string; label: string; profile: string; resume: string; source: 'profile' | 'resume' | 'edit' | null; onPick: (source: 'profile' | 'resume') => void }) {
  return (
    <div className="rr-choices" role="radiogroup" aria-label={`${label}: which value to keep`}>
      <label className="rr-choice">
        <input type="radio" name={name} checked={source === 'profile'} onChange={() => onPick('profile')} />
        <span>
          <b>On your profile</b>
          {profile}
        </span>
      </label>
      <label className="rr-choice">
        <input type="radio" name={name} checked={source === 'resume'} onChange={() => onPick('resume')} />
        <span>
          <b>On the résumé</b>
          {resume}
        </span>
      </label>
    </div>
  );
}

function names(entries: DraftEntry[]): string {
  const labels = entries.map((entry) => [entry.role, entry.organization].filter(Boolean).join(' — ')).filter(Boolean);
  return labels.join(', ') || 'Empty';
}
