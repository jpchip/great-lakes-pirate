/**
 * Game mode state machine (plan 01 §3.2). Each mode implements enter / exit / update /
 * render; overlays sit on top of the active mode and may pause the gameplay tick.
 */

export type ModeId =
  | 'boot'
  | 'mainMenu'
  | 'characterCreation'
  | 'chart'
  | 'sailing'
  | 'onFoot'
  | 'build'
  | 'jail'
  | 'gameOver';

export type OverlayId =
  'trade' | 'dialog' | 'inventory' | 'journal' | 'pause' | 'boarding' | 'loading';

const IN_GAME: readonly ModeId[] = ['chart', 'sailing', 'onFoot', 'build', 'jail'];

/** Allowed transitions, from the diagram in plan 01 §3.2. */
export const TRANSITIONS: Readonly<Record<ModeId, readonly ModeId[]>> = {
  boot: ['mainMenu'],
  // Continue resumes in whichever in-game mode the run was saved in.
  mainMenu: ['characterCreation', 'chart', 'sailing', 'onFoot'],
  characterCreation: ['mainMenu', 'sailing'],
  // Chart → Sailing also covers encounter interrupts.
  chart: ['sailing', 'jail', 'mainMenu', 'gameOver'],
  sailing: ['chart', 'onFoot', 'jail', 'mainMenu', 'gameOver'],
  onFoot: ['sailing', 'build', 'jail', 'mainMenu', 'gameOver'],
  build: ['onFoot', 'mainMenu', 'gameOver'],
  jail: ['onFoot', 'mainMenu', 'gameOver'],
  gameOver: ['mainMenu'],
};

export function isInGame(mode: ModeId): boolean {
  return IN_GAME.includes(mode);
}

export interface Mode {
  readonly id: ModeId;
  enter?(from: ModeId | undefined): void;
  exit?(to: ModeId): void;
  /** One fixed gameplay tick. */
  update?(dt: number): void;
  /** One render frame; `alpha` interpolates between ticks. */
  render?(alpha: number, frameSeconds: number): void;
}

export class ModeTransitionError extends Error {
  override name = 'ModeTransitionError';
}

export class ModeMachine {
  private readonly modes = new Map<ModeId, Mode>();
  private current: Mode | undefined;
  private readonly overlays: { id: OverlayId; pausesGameplay: boolean }[] = [];
  private readonly listeners = new Set<(from: ModeId | undefined, to: ModeId) => void>();

  register(mode: Mode): this {
    this.modes.set(mode.id, mode);
    return this;
  }

  get mode(): ModeId | undefined {
    return this.current?.id;
  }

  /** Enter `to`, checking the transition table. The first transition may go anywhere. */
  transition(to: ModeId): void {
    const next = this.modes.get(to);
    if (!next) throw new ModeTransitionError(`Mode "${to}" is not registered`);
    const from = this.current;
    if (from && !TRANSITIONS[from.id].includes(to)) {
      throw new ModeTransitionError(`Illegal transition ${from.id} → ${to}`);
    }
    from?.exit?.(to);
    // Overlays belong to the mode they were opened in, except the loading fade, which
    // covers the change from the chart to a zone (Phase 3 piece D).
    const loading = this.overlays.filter((o) => o.id === 'loading');
    this.overlays.length = 0;
    this.overlays.push(...loading);
    this.current = next;
    next.enter?.(from?.id);
    for (const listener of this.listeners) listener(from?.id, to);
  }

  onTransition(listener: (from: ModeId | undefined, to: ModeId) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pushOverlay(id: OverlayId, pausesGameplay = true): void {
    this.overlays.push({ id, pausesGameplay });
  }

  popOverlay(): OverlayId | undefined {
    return this.overlays.pop()?.id;
  }

  /** Closes the topmost overlay with this id, wherever it is in the stack. */
  removeOverlay(id: OverlayId): boolean {
    const i = this.overlays.map((o) => o.id).lastIndexOf(id);
    if (i < 0) return false;
    this.overlays.splice(i, 1);
    return true;
  }

  /** True while an overlay with this id is open anywhere in the stack. */
  hasOverlay(id: OverlayId): boolean {
    return this.overlays.some((o) => o.id === id);
  }

  get topOverlay(): OverlayId | undefined {
    return this.overlays.at(-1)?.id;
  }

  /** True when an open overlay stops the gameplay tick. Rendering continues. */
  get gameplayPaused(): boolean {
    return this.overlays.some((o) => o.pausesGameplay);
  }

  update(dt: number): void {
    if (!this.gameplayPaused) this.current?.update?.(dt);
  }

  render(alpha: number, frameSeconds: number): void {
    this.current?.render?.(alpha, frameSeconds);
  }
}
