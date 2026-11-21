// A career the student asked to learn, added to the list the opportunity agents read.
// Null when it is blank or already there, so asking again does not start another search.

const MAX = 12;

export function withCareerInterest(current: string[] | undefined, career: string): string[] | null {
  const title = career.trim().slice(0, 60);
  if (title.length < 2) return null;
  const list = current ?? [];
  if (list.some((item) => item.toLowerCase() === title.toLowerCase())) return null;
  return [...list, title].slice(-MAX);
}
