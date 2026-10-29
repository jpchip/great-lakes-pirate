/**
 * Input action map (plan 01 §4.8): physical keys and mouse buttons map to semantic
 * actions, with one binding context per mode. Bindings are plain data, so the player's
 * rebinds are saved as overrides in the settings store (plan 13 §9, core/settings).
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
  | 'Jump'
  | 'SteerPort'
  | 'SteerStarboard'
  | 'RaiseSail'
  | 'LowerSail'
  | 'TrimIn'
  | 'TrimOut'
  | 'Anchor'
  | 'Sweeps'
  | 'Lantern'
  | 'Spyglass'
  | 'AimMode'
  | 'Fire'
  | 'ToggleChart';

export type Bindings = Record<InputContext, Partial<Record<Action, readonly string[]>>>;

export const DEFAULT_BINDINGS: Bindings = {
  menu: {
    Confirm: ['Enter', 'Space'],
    Cancel: ['Escape'],
  },
  // Plan 02 §2. Interact stays F here; on foot it is E for now (plan 08 §19).
  sailing: {
    Pause: ['Escape'],
    SteerPort: ['KeyA', 'ArrowLeft'],
    SteerStarboard: ['KeyD', 'ArrowRight'],
    RaiseSail: ['KeyW', 'ArrowUp'],
    LowerSail: ['KeyS', 'ArrowDown'],
    TrimIn: ['KeyQ'],
    TrimOut: ['KeyE'],
    Anchor: ['KeyX'],
    Sweeps: ['KeyR'],
    Lantern: ['KeyL'],
    Spyglass: ['Mouse2'],
    Interact: ['KeyF'],
    ToggleChart: ['KeyM'],
    // Reserved for combat (plan 07).
    AimMode: ['Tab'],
    Fire: ['Mouse0'],
  },
  onFoot: {
    Pause: ['Escape'],
    MoveForward: ['KeyW'],
    MoveBack: ['KeyS'],
    MoveLeft: ['KeyA'],
    MoveRight: ['KeyD'],
    // Not Ctrl: Ctrl+W (crouch while moving) closes the browser tab (spike S5).
    Crouch: ['KeyC'],
    // A hop for now; vault and climb at marked spots share Space later (plan 08 §3.1).
    Jump: ['Space'],
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

/**
 * The actions the settings screen lets the player rebind (plan 13 §9), per context, in
 * the order it lists them. Combat stays reserved until plan 07.
 */
export const REBINDABLE: Partial<Record<InputContext, readonly Action[]>> = {
  sailing: [
    'SteerPort',
    'SteerStarboard',
    'RaiseSail',
    'LowerSail',
    'TrimIn',
    'TrimOut',
    'Anchor',
    'Sweeps',
    'Lantern',
    'Spyglass',
    'Interact',
    'ToggleChart',
  ],
};

/** Keys a rebind may not take: Escape always opens and closes the menu. */
export const RESERVED_CODES: readonly string[] = ['Escape'];

/**
 * Bind `code` as the primary input for `action` in `context`. The action keeps its
 * other inputs (the arrow keys beside WASD), and any other action in the same context
 * that used `code` loses it, so one key never means two things. Returns new bindings.
 */
export function rebind(
  bindings: Bindings,
  context: InputContext,
  action: Action,
  code: string,
): Bindings {
  if (RESERVED_CODES.includes(code)) return bindings;
  const next: Partial<Record<Action, readonly string[]>> = {};
  for (const [other, codes] of Object.entries(bindings[context]) as [Action, string[]][]) {
    next[other] = other === action ? codes : codes.filter((c) => c !== code);
  }
  const current = (next[action] ?? []).filter((c) => c !== code);
  next[action] = [code, ...current.slice(1)];
  return { ...bindings, [context]: next };
}

/**
 * The per-context differences between `bindings` and `defaults`, for the settings store.
 */
export function bindingOverrides(
  bindings: Bindings,
  defaults: Bindings = DEFAULT_BINDINGS,
): Partial<Record<InputContext, Partial<Record<Action, string[]>>>> {
  const out: Partial<Record<InputContext, Partial<Record<Action, string[]>>>> = {};
  for (const context of Object.keys(bindings) as InputContext[]) {
    const actions = new Set([
      ...Object.keys(bindings[context]),
      ...Object.keys(defaults[context]),
    ] as Action[]);
    for (const action of actions) {
      const now = bindings[context][action] ?? [];
      const was = defaults[context][action] ?? [];
      if (now.length === was.length && now.every((c, i) => c === was[i])) continue;
      (out[context] ??= {})[action] = [...now];
    }
  }
  return out;
}

const MOUSE_LABELS: Record<string, string> = {
  Mouse0: 'Left mouse',
  Mouse1: 'Middle mouse',
  Mouse2: 'Right mouse',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
};

/** A readable name for a KeyboardEvent.code or mouse button. */
export function codeLabel(code: string): string {
  const mouse = MOUSE_LABELS[code];
  if (mouse) return mouse;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return `${code.slice(5)} arrow`;
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code.replace(/(Left|Right)$/, ' ($1)').replace(/([a-z])([A-Z])/g, '$1 $2');
}
