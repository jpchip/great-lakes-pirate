/**
 * What the build mode's panel shows (plan 09 §9, plan 13 §12; Phase 8 piece C): the
 * palette by category with each piece's materials, costs and how many the materials on
 * hand would pay for; the ghost's verdict by the cursor; the build queue's summary and the
 * Build button. The game fills it; the panel only draws it and calls the actions.
 */

export interface BuildVariantView {
  index: number;
  material: string;
  cost: string;
  /** How many the materials on hand would pay for, after the queue's needs. */
  afford: number;
}

export interface BuildPieceView {
  id: string;
  name: string;
  variants: BuildVariantView[];
}

export interface BuildNeedView {
  good: string;
  name: string;
  need: number;
  have: number;
}

export interface BuildPanelSnapshot {
  /** "Presque Isle bay, Stockton Island". */
  site: string;
  level: number;
  levels: number;
  grid: boolean;
  tool: 'place' | 'remove';
  category: string;
  categories: { id: string; name: string }[];
  pieces: BuildPieceView[];
  held: { id: string; variant: number; name: string } | undefined;
  /** What the cursor would do, by the cursor: "Place · 4 lumber", or why not, in red. */
  cursor: { text: string; ok: boolean; x: number; y: number } | undefined;
  queue: {
    pieces: number;
    needs: BuildNeedView[];
    /** "About 9 hours" of work, with the crew and season. */
    time: string;
    /** How many of the ghosts the materials on hand would build now. */
    buildable: number;
  };
  /** Materials on hand: the hideout's storage, and the hold if she's moored here. */
  onHand: { name: string; qty: number }[];
  fromHold: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** The last thing that happened ("Built 12 pieces in 9 hours"). */
  message: string | undefined;
}

export interface BuildActions {
  category(id: string): void;
  piece(id: string, variant: number): void;
  tool(tool: 'place' | 'remove'): void;
  level(delta: number): void;
  grid(): void;
  undo(): void;
  redo(): void;
  build(): void;
  close(): void;
}
