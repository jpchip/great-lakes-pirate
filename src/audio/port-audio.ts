import type { SoundBank } from './bank';
import { PRIORITY, type AudioMixer } from './mixer';

/**
 * Trade sounds (plan 15 §4.6, Phase 4 piece J): the port screen and the journal open
 * and close with paper, a trade counts coins onto the counter and the purser writes it in
 * the ledger, and the chandler's bill is paid the same way. On the UI bus ("Interface"
 * on the Sound tab), not placed: they are the screen's own sounds.
 */

export const PORT_AUDIO_BUNDLE = 'port-audio';

export const PORT_SOUND = {
  coins: ['ui.trade.coins-1', 'ui.trade.coins-2', 'ui.trade.coins-3'],
  pile: 'ui.trade.coins-pile',
  pen: 'ui.ledger.pen',
  open: 'ui.ledger.open',
  close: 'ui.ledger.close',
} as const;

/** A trade at or above this many cents pours the coins out: $100 in 1900 money. */
export const PILE_CENTS = 10_000;

/**
 * How many handfuls of coins a payment of `totalCents` is counted out in: one for small
 * change, up to four for a large sum, and the poured heap past `PILE_CENTS`.
 */
export function coinCount(totalCents: number): { handfuls: number; pile: boolean } {
  const cents = Math.max(0, totalCents);
  if (cents >= PILE_CENTS) return { handfuls: 1, pile: true };
  const handfuls = cents < 500 ? 1 : cents < 2000 ? 2 : cents < 5000 ? 3 : 4;
  return { handfuls, pile: false };
}

export class TradeCues {
  /** The last cue played, for the dev panel and the smoke test. */
  last = '';

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  /** The port screen or the journal opened. */
  opened(): void {
    this.play(PORT_SOUND.open, 0.6, 0);
    this.last = 'open';
  }

  closed(): void {
    this.play(PORT_SOUND.close, 0.55, 0);
    this.last = 'close';
  }

  /** Coins for a payment either way, then the pen writes it into the ledger. */
  paid(totalCents: number): void {
    const { handfuls, pile } = coinCount(totalCents);
    let t = 0;
    if (pile) {
      this.play(PORT_SOUND.pile, 0.8, 0);
      t = 1.1;
    } else {
      for (let k = 0; k < handfuls; k++) {
        const id = PORT_SOUND.coins[Math.floor(this.random() * PORT_SOUND.coins.length)];
        if (id) this.play(id, 0.7 * (1 - 0.1 * k), t, this.between(0.94, 1.08));
        t += this.between(0.16, 0.26);
      }
      t += 0.2;
    }
    // A short stroke of the pen: a slice of the scratching.
    const pen = this.bank.get(PORT_SOUND.pen);
    if (pen) {
      const length = Math.min(pen.duration, this.between(0.5, 0.8));
      this.mixer.play({
        buffer: pen,
        bus: 'ui',
        gain: 0.45,
        delay: t,
        offset: this.random() * Math.max(0, pen.duration - length),
        duration: length,
        fadeOutS: 0.08,
        priority: PRIORITY.sfx,
      });
    }
    this.last = pile ? 'pile' : `coins x${handfuls}`;
  }

  private play(id: string, gain: number, delay: number, rate = 1): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus: 'ui', gain, delay, rate, priority: PRIORITY.sfx });
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }
}
