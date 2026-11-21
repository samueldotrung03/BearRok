// Which student a résumé call is for. Signed-in calls stay on /me and keep their token.
// With sign-in turned off on the backend, a guest is the local user and uses the demo student.

export type ResumeStudent = 'me' | 'demo';

export function resumeStudent(
  status: 'loading' | 'signedOut' | 'signedIn' | 'guest',
  signInEnabled: boolean | null,
): ResumeStudent | null {
  if (status === 'signedIn') return 'me';
  if (status === 'guest' && signInEnabled === false) return 'demo';
  return null;
}
