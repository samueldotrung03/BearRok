/** An error in words: the CLI's or API's JSON error body is cut down to its message. */
export function plainError(error: string | null): string | null {
  if (!error) return error;
  const message = /"message"\s*:\s*"([^"]+)"/.exec(error)?.[1];
  if (!message) return error.trim();
  const lead = error.slice(0, error.indexOf(':')).trim();
  return lead && !error.trimStart().startsWith('{') ? `${lead}: ${message}` : message;
}
