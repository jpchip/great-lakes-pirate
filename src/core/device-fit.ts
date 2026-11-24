/**
 * Is this a phone or tablet? The game is played with a keyboard and mouse, so a
 * touch-only device gets a warning before the menu (and may carry on anyway).
 *
 * The test is the pointer, not the screen or the user agent: a device warns only when
 * its primary pointer is coarse (a finger) AND no fine pointer is attached at all AND
 * nothing can hover. A touchscreen laptop has a touchpad or mouse as its primary, fine
 * pointer, and an iPad with a trackpad keyboard reports a fine pointer too, so neither
 * is flagged.
 */

export const MOBILE_WARNING_KEY = 'glp.mobileWarningDismissed';

export interface PointerEnv {
  /** `(pointer: coarse)`: the primary pointer is a finger. */
  primaryCoarse: boolean;
  /** `(any-pointer: fine)`: some attached pointer is a mouse, touchpad or pen. */
  anyFine: boolean;
  /** `(any-hover: hover)`: some attached pointer can hover. */
  anyHover: boolean;
  /** navigator.maxTouchPoints. */
  touchPoints: number;
}

export function isTouchOnly(env: PointerEnv): boolean {
  return env.primaryCoarse && env.touchPoints > 0 && !env.anyFine && !env.anyHover;
}

/** The browser's pointer facts; an old browser without matchMedia counts as a desktop. */
export function browserPointerEnv(win: Window = window): PointerEnv {
  const mq = (q: string): boolean => {
    try {
      return win.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  return {
    primaryCoarse: mq('(pointer: coarse)'),
    anyFine: mq('(any-pointer: fine)'),
    anyHover: mq('(any-hover: hover)'),
    touchPoints: win.navigator.maxTouchPoints || 0,
  };
}

/** Warn on a touch-only device, unless the player already chose to carry on here. */
export function shouldWarnMobile(
  env: PointerEnv,
  storage: Pick<Storage, 'getItem'> | undefined,
): boolean {
  if (!isTouchOnly(env)) return false;
  try {
    return storage?.getItem(MOBILE_WARNING_KEY) !== '1';
  } catch {
    return true;
  }
}

export function rememberMobileDismissed(storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(MOBILE_WARNING_KEY, '1');
  } catch {
    // Private modes may refuse storage: the warning just comes back next visit.
  }
}
