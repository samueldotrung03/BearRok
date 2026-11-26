// Event names in the week and day views get as many lines as the event's height holds.
import { describe, expect, it } from 'vitest';
import { eventLines } from './TimeGrid.tsx';

describe('eventLines', () => {
  it('gives a half-hour event one line of title', () => {
    expect(eventLines(24)).toEqual({ title: 1, time: false });
  });

  it('gives a one-hour event two lines of title instead of a cut-off name and its time', () => {
    expect(eventLines(48)).toEqual({ title: 2, time: false });
  });

  it('shows the time once the title still has two lines', () => {
    expect(eventLines(72)).toEqual({ title: 3, time: true });
    expect(eventLines(96)).toEqual({ title: 4, time: true });
  });

  it('never gives less than one line', () => {
    expect(eventLines(10).title).toBe(1);
  });
});
