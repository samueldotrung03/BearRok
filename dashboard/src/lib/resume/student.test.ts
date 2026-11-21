import { describe, expect, it } from 'vitest';
import { resumeStudent } from './student.ts';

describe('resumeStudent', () => {
  it('keeps a signed-in student on their own account whether or not this server requires sign-in', () => {
    expect(resumeStudent('signedIn', true)).toBe('me');
    expect(resumeStudent('signedIn', false)).toBe('me');
    expect(resumeStudent('signedIn', null)).toBe('me');
  });

  it('uses the local demo student only when sign-in is off', () => {
    expect(resumeStudent('guest', false)).toBe('demo');
    expect(resumeStudent('guest', true)).toBeNull();
    expect(resumeStudent('guest', null)).toBeNull();
  });

  it('does not upload for someone who is signed out or still loading', () => {
    expect(resumeStudent('signedOut', false)).toBeNull();
    expect(resumeStudent('loading', false)).toBeNull();
  });
});
