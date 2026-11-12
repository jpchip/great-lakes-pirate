/**
 * What the jail screens show (plan 13 §12 Phase 5 "jail screens", plan 12 §8.1; piece D):
 * the cell (what was taken, the sentence, bail by sending word, the jailbreak not yet), the
 * gallows at tier 5, and the release with "While you were inside...".
 */

export interface WordOption {
  hideout: string;
  name: string;
  /** "$212 in the strongbox". */
  cash: string;
  /** Enough there for bail, the ship and the messenger. */
  enough: boolean;
}

export interface CellSnapshot {
  kind: 'cell';
  /** A minor arrest: nothing taken, no impound, no bail to send word for. */
  minor?: boolean;
  lockup: string;
  /** "Taken by the revenue cutter Morrill off the Apostle Islands, Wk of June 4, 1900". */
  taken: string;
  /** The region's tier then: "Hunted". */
  tierName: string;
  sentenceWeeks: number;
  /** "Out the week of July 2, 1900". */
  releaseText: string;
  confiscated: string[];
  bail: string;
  impound: string;
  /** The messenger's fee. */
  wordFee: string;
  /** Bail, the ship and the messenger together. */
  wordTotal: string;
  wordOptions: WordOption[];
  /** Word is on its way: when it comes. */
  wordSent: string | undefined;
  /** Why "send word" can't be done, if it can't. */
  wordRefusal: string | undefined;
  /** What the jailbreak stub says. */
  jailbreak: string;
}

export interface GallowsSnapshot {
  kind: 'gallows';
  lockup: string;
  taken: string;
  confiscated: string[];
  jailbreak: string;
}

export interface ReleaseSnapshot {
  kind: 'released';
  /** "Released on bail" or "Time served". */
  title: string;
  /** "Five weeks in the Bayfield lockup...". */
  lead: string;
  /** "While you were inside..." lines. */
  inside: string[];
  /** How the ship came back. */
  ship: string;
  /** Over the list: "While you were inside..." unless given (abandon ship tells its own). */
  heading?: string;
  /** The button: "Back aboard" unless given. */
  leaveLabel?: string;
}

export type JailSnapshot = CellSnapshot | GallowsSnapshot | ReleaseSnapshot;

export interface JailActions {
  /** Serve the sentence: the days pass. */
  serve(): void;
  /** Send word to a hideout for bail. */
  sendWord(hideout: string): void;
  /** The jailbreak: not yet (Phase 7). */
  jailbreak(): void;
  /** At the gallows: the end. */
  hang(): void;
  /** From the release screen, back aboard. */
  leave(): void;
}
