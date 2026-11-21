// Running out of Grok usage. Every call after the first would fail the same way, so the first one
// ends the whole search with one clear reason instead of failing, retrying and timing out per agent.

export const BALANCE_MESSAGE = 'Grok usage balance exhausted; top up to continue';

export class BalanceExhaustedError extends Error {
  constructor() {
    super(BALANCE_MESSAGE);
    this.name = 'BalanceExhaustedError';
  }
}

/** True for the CLI's or the API's "out of credit" answers (HTTP 402, "usage balance exhausted"). */
export function isBalanceError(text: string): boolean {
  return /\b402\b|payment required|usage balance (is )?exhausted|insufficient (credits?|balance)|out of credits?/i.test(text);
}
