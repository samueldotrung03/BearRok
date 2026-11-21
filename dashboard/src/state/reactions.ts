// Which save, like, dislike and open actions to send to the agents. A second send of save, like
// or dislike undoes the first, the same way the cards do.

export interface Reactions {
  saved: string[];
  liked: string[];
  dismissed: string[];
  opened: string[];
}

export function reactionSends(before: Reactions | null, now: Reactions, known: Set<string>): { id: string; action: string }[] {
  if (!before) return [];
  const changed = (a: string[], b: string[]) => [...a.filter((id) => !b.includes(id)), ...b.filter((id) => !a.includes(id))].filter((id) => known.has(id));
  return [
    ...changed(before.saved, now.saved).map((id) => ({ id, action: 'save' })),
    ...changed(before.liked, now.liked).map((id) => ({ id, action: 'like' })),
    ...changed(before.dismissed, now.dismissed).map((id) => ({ id, action: 'dislike' })),
    ...now.opened.filter((id) => !before.opened.includes(id) && known.has(id)).map((id) => ({ id, action: 'open' })),
  ];
}
