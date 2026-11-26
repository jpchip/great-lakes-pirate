import type { CargoStack } from '../sim/economy/hold';
import { COLD } from '../sim/cold/footing';
import { loadSled, moveLot, sledFree, sledUsed, unloadSled, type Sled } from '../sim/cold/sled';

/**
 * The hand sled's picker (piece M): beside the ship on the ice, choose what goes onto the
 * sled from her hold and what comes back off it, a CU or a whole lot at a time, or fill
 * her with the most valuable as before. Contract cargo stays aboard. Opens over the game
 * like the bunk's choice, and puts the sled away from it when she's empty.
 */

export interface SledLotRow {
  /** Its index in the hold or on the sled. */
  index: number;
  name: string;
  qty: number;
  hot: boolean;
  /** Freight under contract: it stays aboard. */
  contract: boolean;
}

export interface SledView {
  used: number;
  capacity: number;
  hold: SledLotRow[];
  sled: SledLotRow[];
  message: string | undefined;
}

export interface SledActions {
  /** Onto the sled from the hold's lot `index`: `qty` CU, or all that fits. */
  load(index: number, qty?: number): void;
  /** Off the sled into the hold: `qty` CU of the lot, or all of it. */
  unload(index: number, qty?: number): void;
  /** The most valuable CU first, as far as she'll take. */
  fill(): void;
  /** Everything back aboard. */
  empty(): void;
  /** The sled stowed aboard (empty only). */
  stow(): void;
  close(): void;
}

export interface SledPickerDeps {
  sled(): Sled | undefined;
  hold(): CargoStack[];
  holdChanged(): void;
  goodName(good: string): string;
  valueOf(good: string): number;
  show(view: SledView | undefined): void;
  onOpen(open: boolean): void;
  /** The sled's load moved, or she was stowed (for the sounds). */
  handled(act: 'loaded' | 'unloaded' | 'stowed'): void;
}

export interface SledPicker {
  readonly isOpen: boolean;
  open(): void;
  actions: SledActions;
}

export function attachSledPicker(deps: SledPickerDeps): SledPicker {
  let open = false;
  let message: string | undefined;

  const rows = (lots: CargoStack[]): SledLotRow[] =>
    lots.map((l, index) => ({
      index,
      name: deps.goodName(l.good),
      qty: l.qty,
      hot: !!l.hot,
      contract: !!l.contract,
    }));

  const view = (): SledView | undefined => {
    const s = deps.sled();
    if (!s) return undefined;
    return {
      used: sledUsed(s),
      capacity: COLD.sled.capacityCu,
      hold: rows(deps.hold()),
      sled: rows(s.load),
      message,
    };
  };

  const refresh = (): void => {
    if (open) deps.show(view());
  };

  const close = (): void => {
    if (!open) return;
    open = false;
    message = undefined;
    deps.show(undefined);
    deps.onOpen(false);
  };

  /** Moves a lot and says so; `act` for the sounds. */
  const moved = (n: number, act: 'loaded' | 'unloaded', refused: string): void => {
    if (n > 0) {
      deps.holdChanged();
      deps.handled(act);
      message = undefined;
    } else message = refused;
    refresh();
  };

  return {
    get isOpen() {
      return open;
    },
    open() {
      if (open || !deps.sled()) return;
      open = true;
      message = undefined;
      deps.onOpen(true);
      refresh();
    },
    actions: {
      load(index, qty) {
        const s = deps.sled();
        if (!s) return close();
        const lot = deps.hold()[index];
        if (lot?.contract) {
          message = 'Contract freight stays aboard.';
          return refresh();
        }
        const n = moveLot(deps.hold(), s.load, index, qty ?? lot?.qty ?? 0, sledFree(s));
        moved(n, 'loaded', sledFree(s) > 0 ? 'Nothing to load.' : 'The sled is full.');
      },
      unload(index, qty) {
        const s = deps.sled();
        if (!s) return close();
        const n = moveLot(s.load, deps.hold(), index, qty ?? s.load[index]?.qty ?? 0);
        moved(n, 'unloaded', 'Nothing to unload.');
      },
      fill() {
        const s = deps.sled();
        if (!s) return close();
        moved(
          loadSled(s, deps.hold(), deps.valueOf),
          'loaded',
          sledFree(s) > 0 ? 'Nothing in the hold to load.' : 'The sled is full.',
        );
      },
      empty() {
        const s = deps.sled();
        if (!s) return close();
        moved(unloadSled(s, deps.hold()), 'unloaded', 'The sled is empty.');
      },
      stow() {
        const s = deps.sled();
        if (!s) return close();
        if (s.load.length) {
          message = 'Unload her first.';
          return refresh();
        }
        deps.handled('stowed');
        close();
      },
      close,
    },
  };
}
