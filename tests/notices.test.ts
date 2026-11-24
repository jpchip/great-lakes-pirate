import { describe, expect, it } from 'vitest';
import {
  NOTICE_LOG,
  NOTICE_MAX_S,
  NOTICE_MIN_S,
  NOTICE_STACK,
  NoticeBoard,
  noticeSeconds,
} from '../src/ui/hud/notices';

describe('HUD notices', () => {
  it('stay up longer for longer lines, within bounds', () => {
    expect(noticeSeconds('Moored')).toBe(NOTICE_MIN_S);
    const mid = noticeSeconds('Found a coil of rope and two tins of biscuit in the crate');
    expect(mid).toBeGreaterThan(NOTICE_MIN_S);
    expect(mid).toBeLessThan(NOTICE_MAX_S);
    expect(noticeSeconds('word '.repeat(80))).toBe(NOTICE_MAX_S);
  });

  it('stack instead of the next one wiping the last', () => {
    const b = new NoticeBoard();
    b.show('Found rope', 0, 'd');
    b.show('Found biscuit', 0.5, 'd');
    expect(b.visible()).toEqual(['Found rope', 'Found biscuit']);
    for (let i = 0; i < NOTICE_STACK + 2; i++) b.show(`line ${i}`, 1, 'd');
    expect(b.visible()).toHaveLength(NOTICE_STACK);
    expect(b.visible().at(-1)).toBe(`line ${NOTICE_STACK + 1}`);
  });

  it('come down when their time is up', () => {
    const b = new NoticeBoard();
    b.show('Moored', 0, 'd');
    expect(b.expire(NOTICE_MIN_S - 0.1)).toBe(false);
    expect(b.expire(NOTICE_MIN_S + 0.1)).toBe(true);
    expect(b.visible()).toEqual([]);
  });

  it('hold at least as long as asked', () => {
    const b = new NoticeBoard();
    b.show('F again to dock', 0, 'd', 20);
    b.expire(15);
    expect(b.visible()).toEqual(['F again to dock']);
  });

  it('keep a log, newest first, folding repeats and trimming the oldest', () => {
    const b = new NoticeBoard();
    b.show('Not now', 0, 'Mon 08:00');
    b.show('Not now', 1, 'Mon 08:01');
    b.show('Found rope', 2, 'Mon 08:02');
    expect(b.log().map((e) => [e.text, e.count, e.when])).toEqual([
      ['Found rope', 1, 'Mon 08:02'],
      ['Not now', 2, 'Mon 08:01'],
    ]);
    // Gone from the HUD, still in the log.
    b.expire(100);
    expect(b.visible()).toEqual([]);
    expect(b.log()).toHaveLength(2);
    for (let i = 0; i < NOTICE_LOG + 5; i++) b.show(`n${i}`, 200, 'd');
    expect(b.log()).toHaveLength(NOTICE_LOG);
    expect(b.log()[0]?.text).toBe(`n${NOTICE_LOG + 4}`);
  });
});
