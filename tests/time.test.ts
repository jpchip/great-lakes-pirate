import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  calendarDate,
  createClockState,
  dayAndHour,
  fastForward,
  R_ON_FOOT,
  R_SAILING,
  SECONDS_PER_GAME_DAY,
} from '../src/core/time';

describe('game clock', () => {
  it('runs a full day in 60 real minutes at R = 24', () => {
    const clock = createClockState();
    advanceClock(clock, 60 * 60, R_SAILING);
    expect(clock.gameSeconds).toBe(SECONDS_PER_GAME_DAY);
  });

  it('runs 6 game minutes per real minute on foot', () => {
    const clock = createClockState();
    advanceClock(clock, 60, R_ON_FOOT);
    expect(clock.gameSeconds).toBe(6 * 60);
  });

  it('fires a world tick every 10 game minutes, carrying the remainder', () => {
    const clock = createClockState();
    // 1 real second at R = 24 is 24 game seconds; 25 s → 600 game seconds.
    let ticks = 0;
    for (let i = 0; i < 25; i++) ticks += advanceClock(clock, 1, R_SAILING);
    expect(ticks).toBe(1);
    expect(advanceClock(clock, 0, R_SAILING)).toBe(0);
  });

  it('starts the calendar the week of Monday, May 7, 1900, one week per game day', () => {
    expect(calendarDate(0).toISOString().slice(0, 10)).toBe('1900-05-07');
    expect(calendarDate(SECONDS_PER_GAME_DAY).toISOString().slice(0, 10)).toBe('1900-05-14');
    expect(calendarDate(SECONDS_PER_GAME_DAY * 52).getUTCFullYear()).toBe(1901);
  });

  it('splits game time into day and hour', () => {
    expect(dayAndHour(SECONDS_PER_GAME_DAY * 2 + 3600 * 6)).toEqual({ day: 2, hour: 6 });
  });

  it('batch fast-forwards a 12-week jail sentence in ~1,700 world ticks', () => {
    const clock = createClockState();
    let ran = 0;
    const ticks = fastForward(clock, 12 * SECONDS_PER_GAME_DAY, () => ran++);
    expect(ticks).toBe(1728);
    expect(ran).toBe(ticks);
  });
});
