/**
 * The HUD's notices: the short lines bottom left that say what just happened ("Found a coil
 * of rope", "No berth in reach"). Each stays up long enough to read, by its length; a few
 * stack rather than the next one wiping the last; and every one goes into a short log the
 * journal shows on its Messages page, so a line that went by too fast can be read again.
 */

/** Shortest and longest time a notice stays up, seconds. */
export const NOTICE_MIN_S = 4;
export const NOTICE_MAX_S = 10;
/** Seconds of reading per word, on top of a short glance to catch it. */
const NOTICE_BASE_S = 2.5;
const NOTICE_PER_WORD_S = 0.35;
/** How many notices show at once; the oldest goes when another comes. */
export const NOTICE_STACK = 3;
/** How many the log keeps. */
export const NOTICE_LOG = 50;

/** How long a notice stays up: long enough to read it, by its words. */
export function noticeSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const s = NOTICE_BASE_S + NOTICE_PER_WORD_S * words;
  return Math.min(NOTICE_MAX_S, Math.max(NOTICE_MIN_S, s));
}

export interface NoticeLogEntry {
  /** Unique within the run's log, for keys. */
  id: number;
  text: string;
  /** When it came, as the HUD writes the date and time. */
  when: string;
  /** The same line again and again in a row is one entry, counted. */
  count: number;
}

interface Shown {
  text: string;
  untilS: number;
}

export class NoticeBoard {
  private shown: Shown[] = [];
  private entries: NoticeLogEntry[] = [];
  private nextId = 1;

  /**
   * A notice at `nowS` (the HUD's clock), stamped `when` in the log; `holdS` keeps it up at
   * least that long (a line that waits on a second press).
   */
  show(text: string, nowS: number, when: string, holdS = 0): void {
    const untilS = nowS + Math.max(noticeSeconds(text), holdS);
    const same = this.shown.find((n) => n.text === text);
    if (same) {
      // The same line again: keep it where it is, up for the full time once more.
      same.untilS = Math.max(same.untilS, untilS);
    } else {
      this.shown.push({ text, untilS });
      while (this.shown.length > NOTICE_STACK) this.shown.shift();
    }
    const last = this.entries[0];
    if (last && last.text === text) {
      this.entries[0] = { ...last, when, count: last.count + 1 };
    } else {
      this.entries.unshift({ id: this.nextId++, text, when, count: 1 });
      if (this.entries.length > NOTICE_LOG) this.entries.length = NOTICE_LOG;
    }
  }

  /** Takes down what has had its time; true when anything went. */
  expire(nowS: number): boolean {
    const before = this.shown.length;
    this.shown = this.shown.filter((n) => nowS <= n.untilS);
    return this.shown.length !== before;
  }

  /** What's up now, oldest first. */
  visible(): string[] {
    return this.shown.map((n) => n.text);
  }

  /** The log, newest first. */
  log(): readonly NoticeLogEntry[] {
    return this.entries;
  }

  clear(): void {
    this.shown = [];
    this.entries = [];
  }
}
