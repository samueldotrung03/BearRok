// What the empty feed says. Real runs are described from the memory the agents stored.

export interface FeedOutcome {
  found: number;
  rejected: number;
  searches: number;
  runs: number;
}

export function emptyFeedCopy(input: {
  offline: boolean;
  searching: boolean;
  shown: number;
  target: number;
  outcome: FeedOutcome | null;
}): string {
  if (input.offline) return 'The agents cannot be reached right now, so there is nothing new to show. This page fills in on its own once they are back.';
  const aim =
    input.shown < input.target
      ? `Your agents have found ${input.shown} of the ${input.target} opportunities they aim for${input.searching ? ' and are searching for more' : '. They search again on their own'}.`
      : 'Refresh to re-rank the feed with what you saved and skipped.';
  const ran = input.outcome && input.outcome.runs > 0 && input.shown === 0 && !input.searching
    ? ` The last ${input.outcome.runs === 1 ? 'search' : `${input.outcome.runs} searches`} ran ${input.outcome.searches} quer${input.outcome.searches === 1 ? 'y' : 'ies'} and kept ${input.outcome.found}. ${input.outcome.rejected} lead${input.outcome.rejected === 1 ? ' was' : 's were'} turned down.`
    : '';
  return aim + ran;
}
