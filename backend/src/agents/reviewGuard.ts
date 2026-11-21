// A reviewer may only turn a posting down on its own ground and for something the page says.
// These catch the two ways live reviewers over-rejected: the criteria reviewer judging whether a
// posting is still open (the status reviewer's job), and either reviewer rejecting because it
// "could not confirm" something the page never rules out.
import type { ReviewFocus } from './types.ts';

/** About whether it is open now or its dates: the status reviewer decides that, not the criteria one. */
const OPENNESS =
  /\b(still open|no longer (open|accepting)|not (yet )?open (yet|for applications|for registration|for sign-?ups)|sign-?ups (are|is) not open|(applications?|registration|interest form) (were|was|are|is) (due|closed|not open)|(deadline|due date|recruiting window|application window) (has |had )?(passed|closed)|recruiting (window|timeline|cycle)|(this|current|next) (cycle|round)|deadline)\b/i;

/** The reviewer could not find something, which is not the page saying no. */
const SILENCE =
  /\b((cannot|can't|could not|couldn't|unable to)( be)? (confirm|verify|tell|determine)|(does|do|did) not (state|confirm|say|mention|list|specify)|(not|never) (stated|confirmed|mentioned|specified)|no (first-year|freshman|year) confirmation)\b/i;

/** The page rules this student out, or a note does: a real criteria rejection. */
const EXCLUDES =
  /\b(not open to|open only to|only open to|only for|restricted to|limited to|requires?|required|must (be|have)|ineligible|excludes?|upper[- ]?(class|year|division)|juniors? and seniors?|graduate students|ph\.?d|notes? rules? (this|it) out|rules? (this|it) out|remote only|in person in)\b/i;

/** The posting is gone or over: a real status rejection. */
const GONE =
  /\b((cannot|could not|can't|couldn't) be (found|opened)|not found|404|missing page|does not exist|no longer exists|removed|taken down|(has|had) passed|(was|were) due|closed|not open)\b/i;

/** "A note does not rule it out" is the opposite of a note ruling it out. */
const NOT_RULED_OUT = /\b(a |the )?(student's )?notes? (does|do) not rule (it|this) out\b/gi;

/** A hard criterion about being open or a deadline, which only the status reviewer checks. */
const OPEN_CRITERION = /\b(currently open|open now|open right now|accepting (applications|members|registration)|states a deadline)\b/i;

/**
 * Why a rejection does not stand, or null when it does. A criteria rejection that rests only on
 * whether the posting is open is left to the status reviewer; a rejection from either reviewer
 * that rests only on something not being confirmed is not a failure while nothing on the page
 * says no.
 */
export function groundlessReject(focus: ReviewFocus, reason: string): string | null {
  const text = reason.replace(NOT_RULED_OUT, '');
  if (focus === 'criteria') {
    if (EXCLUDES.test(text)) return null;
    if (OPENNESS.test(text)) return "Meets the student's criteria; whether it is still open is for the status reviewer";
    if (SILENCE.test(text)) return "Meets the student's criteria: nothing on the page rules them out";
    return null;
  }
  if (SILENCE.test(text) && !GONE.test(text)) return 'Open: the page is up and does not say it is closed';
  return null;
}

/** True for a hard criterion about being open or a deadline, which only the status reviewer checks. */
export function aboutOpenness(criterion: string): boolean {
  return OPENNESS.test(criterion) || OPEN_CRITERION.test(criterion);
}
