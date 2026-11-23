import type { CaptureOutcome } from '../../sim/law/jail';
import { riskWord } from '../../sim/economy/contraband';
import { dollars } from './ship-card';

/**
 * What a law ship's hail is likely to cost you, so heaving to or running is a choice made
 * knowing the stakes: the search and its odds, what a find would bring, and what capture
 * here comes to. A plain model the HUD draws beside the helm while she's after you; built
 * by `hailForecast` from what the law and the hold say now. The odds stay words, as at the
 * merchants' (`riskWord`).
 */
export interface HailForecast {
  /** The law ship's id, for tests. */
  by: string;
  /** `The Morrill: "Heave to for inspection!"` */
  title: string;
  /** "You're Suspicious here." */
  standing: string;
  heaveTo: { head: string; lines: string[] };
  run: { head: string; lines: string[] };
}

/** A lot she'd take if her search party turned it up. */
export interface ForecastLot {
  name: string;
  qty: number;
  kind: 'hot' | 'contraband';
  /** The odds her search finds it, 0–1. */
  chance: number;
}

/** What capture at a tier takes from you (`captureTakes`, by `jail.json`'s confiscation). */
export interface CaptureTakes {
  /** CU taken, and whether that's the whole hold or only the stolen goods and contraband. */
  cargoCU: number;
  wholeHold: boolean;
  cashCents: number;
  purseCents: number;
}

export interface HailForecastInput {
  by: string;
  /** "The Morrill" or "The tug". */
  name: string;
  intent: 'inspect' | 'pursue';
  arrest: boolean;
  tierName: string;
  lots: readonly ForecastLot[];
  /** Capture at the heat you have now. */
  captureNow: CaptureOutcome;
  /** What capture takes from you now. */
  takes: CaptureTakes;
  /** What the arrest after a find would take (the found lots already gone). */
  takesAfterFind?: CaptureTakes | undefined;
  /**
   * After a find: `any` if one kind found makes you Wanted (she arrests), `all` if only
   * everything found would, `none` if she lets you go whatever she finds. With the capture
   * that arrest would come to.
   */
  arrestOnFind: 'any' | 'all' | 'none';
  captureAfterFind?: CaptureOutcome | undefined;
}

const weeks = (n: number): string => `${n} week${n === 1 ? '' : 's'}`;

/** "Jail, 1 week (bail $34, $20 for the ship). She takes the 4 CU of stolen goods; your purse is left alone." */
export function captureLine(outcome: CaptureOutcome, takes: CaptureTakes): string {
  if (outcome.kind === 'execution') {
    return 'Taken here, it is the rope: one night to break out of the cell, or the end of the run.';
  }
  const lost: string[] = [];
  if (takes.cargoCU > 0)
    lost.push(
      takes.wholeHold
        ? `all ${takes.cargoCU} CU of your cargo`
        : `the ${takes.cargoCU} CU of stolen goods and contraband`,
    );
  if (takes.cashCents > 0)
    lost.push(
      takes.cashCents >= takes.purseCents
        ? `the ${dollars(takes.cashCents)} on hand`
        : `${dollars(takes.cashCents)} of the ${dollars(takes.purseCents)} on hand`,
    );
  const kept: string[] = [];
  if (!takes.wholeHold) kept.push('the rest of the hold');
  if (takes.purseCents > 0 && takes.cashCents === 0) kept.push('your purse');
  const what =
    lost.length > 0
      ? `, confiscates ${lost.join(' and ')}`
      : ', though there is nothing she would take';
  const keep = kept.length > 0 && lost.length > 0 ? `, and leaves you ${kept.join(' and ')}` : '';
  return (
    `Jail, ${weeks(outcome.sentenceWeeks)} (bail ${dollars(outcome.bailCents)}, ` +
    `${dollars(outcome.impoundCents)} for the ship). The law impounds her${what}${keep}.`
  );
}

function lotLine(l: ForecastLot): string {
  const what = l.kind === 'hot' ? 'stolen' : 'contraband';
  return `${l.qty} CU ${l.name}, ${what}: ${riskWord(l.chance)}`;
}

export function hailForecast(f: HailForecastInput): HailForecast {
  const standing = `You're ${f.tierName} here.`;
  const surrender = captureLine(f.captureNow, f.takes);
  const runLines = [
    'Lose her in fog, dark or behind an island, slip into water too shallow for her, or outrun her.',
    `Taken: ${surrender}`,
  ];
  if (f.arrest || f.intent === 'pursue') {
    return {
      by: f.by,
      title: f.arrest
        ? `${f.name}: "You're under arrest. Lie to!"`
        : `${f.name}: "Heave to, in the name of the United States!"`,
      standing,
      heaveTo: { head: 'Heave to: you surrender', lines: [surrender] },
      run: { head: 'Run: a warning shot, then chain at your rigging', lines: runLines },
    };
  }

  const heaveTo: string[] = [];
  if (f.lots.length === 0) {
    heaveTo.push('Nothing in your hold she would take. She searches it and lets you go.');
  } else {
    heaveTo.push(...f.lots.map(lotLine));
    if (f.arrestOnFind === 'none') {
      heaveTo.push('What she finds she takes, and it adds to your heat. Then she lets you go.');
    } else {
      heaveTo.push(
        f.arrestOnFind === 'any'
          ? 'Anything she finds makes you Wanted here, and she arrests you.'
          : 'Find it all and you are Wanted here, and she arrests you.',
      );
      if (f.captureAfterFind)
        heaveTo.push(`Then: ${captureLine(f.captureAfterFind, f.takesAfterFind ?? f.takes)}`);
    }
  }
  return {
    by: f.by,
    title: `${f.name}: "Heave to for inspection!"`,
    standing,
    heaveTo: { head: 'Heave to: she searches the hold', lines: heaveTo },
    run: {
      head: 'Run: a warning shot, then chain at your rigging',
      lines: [...runLines, 'Heave to after her warning shot and it is a surrender.'],
    },
  };
}
