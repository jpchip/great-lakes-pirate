/**
 * Input action map (plan 01 §4.8): physical keys and mouse buttons map to semantic
 * actions, with one binding context per mode. Bindings are plain data so rebinding
 * can be saved in the settings store later (plan 13).
 *
 * Keys use KeyboardEvent.code (layout-independent); mouse buttons are `Mouse0`…`Mouse4`.
 */

export type InputContext = 'menu' | 'sailing' | 'onFoot' | 'chart';

export type Action =
  | 'Pause'
  | 'Confirm'
  | 'Cancel'
  | 'Interact'
  | 'MoveForward'
  | 'MoveBack'
  | 'MoveLeft'
  | 'MoveRight'
  | 'Crouch'
  | 'Sprint'
  | 'TrimSailsIn'
  | 'TrimSailsOut'
  | 'SteerPort'
  | 'SteerStarboard'
  | 'FirePort'
  | 'FireStarboard'
  | 'ToggleChart';

export type Bindings = Record<InputContext, Partial<Record<Action, readonly string[]>>>;

export const DEFAULT_BINDINGS: Bindings = {
  menu: {
    Confirm: ['Enter', 'Space'],
    Cancel: ['Escape'],
  },
  sailing: {
    Pause: ['Escape'],
    SteerPort: ['KeyA', 'ArrowLeft'],
    SteerStarboard: ['KeyD', 'ArrowRight'],
    TrimSailsIn: ['KeyS', 'ArrowDown'],
    TrimSailsOut: ['KeyW', 'ArrowUp'],
    FirePort: ['KeyQ'],
    FireStarboard: ['KeyE'],
    Interact: ['KeyF'],
    ToggleChart: ['KeyM'],
  },
  onFoot: {
    Pause: ['Escape'],
    MoveForward: ['KeyW'],
    MoveBack: ['KeyS'],
    MoveLeft: ['KeyA'],
    MoveRight: ['KeyD'],
    // Not Ctrl: Ctrl+W (crouch while moving) closes the browser tab (spike S5).
    Crouch: ['KeyC'],
    Sprint: ['ShiftLeft'],
    Interact: ['KeyE'],
  },
  chart: {
    Pause: ['Escape'],
    Cancel: ['KeyM'],
    Confirm: ['Enter', 'Mouse0'],
  },
};

/**
 * Tracks held inputs and per-tick presses. Call `endTick()` after each gameplay tick
 * so `pressed()` reports each press exactly once.
 */
export class InputMapper {
  context: InputContext = 'menu';
  private readonly held = new Set<string>();
  private readonly pressedThisTick = new Set<string>();
  private detach: (() => void) | undefined;

  constructor(public bindings: Bindings = DEFAULT_BINDINGS) {}

  attach(target: EventTarget): void {
    this.detachListeners();
    const down = (code: string): void => {
      if (!this.held.has(code)) this.pressedThisTick.add(code);
      this.held.add(code);
    };
    const up = (code: string): void => {
      this.held.delete(code);
    };
    const onKeyDown = (e: Event): void => down((e as KeyboardEvent).code);
    const onKeyUp = (e: Event): void => up((e as KeyboardEvent).code);
    const onMouseDown = (e: Event): void => down(`Mouse${(e as MouseEvent).button}`);
    const onMouseUp = (e: Event): void => up(`Mouse${(e as MouseEvent).button}`);
    const onBlur = (): void => this.held.clear();
    const listeners: [string, (e: Event) => void][] = [
      ['keydown', onKeyDown],
      ['keyup', onKeyUp],
      ['mousedown', onMouseDown],
      ['mouseup', onMouseUp],
      ['blur', onBlur],
    ];
    for (const [type, fn] of listeners) target.addEventListener(type, fn);
    this.detach = () => {
      for (const [type, fn] of listeners) target.removeEventListener(type, fn);
    };
  }

  detachListeners(): void {
    this.detach?.();
    this.detach = undefined;
    this.held.clear();
    this.pressedThisTick.clear();
  }

  /** True while any input bound to `action` in the current context is held. */
  isDown(action: Action): boolean {
    return this.codes(action).some((code) => this.held.has(code));
  }

  /** True if an input bound to `action` went down since the last `endTick()`. */
  pressed(action: Action): boolean {
    return this.codes(action).some((code) => this.pressedThisTick.has(code));
  }

  endTick(): void {
    this.pressedThisTick.clear();
  }

  private codes(action: Action): readonly string[] {
    return this.bindings[this.context][action] ?? [];
  }
}
