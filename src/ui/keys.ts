import { signal } from '@preact/signals';
import {
  codeLabel,
  DEFAULT_BINDINGS,
  type Action,
  type Bindings,
  type InputContext,
} from '../core/input';

/**
 * Key names on screen follow the player's bindings (plan 13 §9 "Full key rebinding"). The
 * prompts and notices are written with the default keys ("F board her", "Hold F to look her
 * over", "Go ashore (G)"); `keyText` swaps each key that has been rebound for its new one,
 * and `keyName` names an action's key for the HUD's key chips. Nothing changes while the
 * keys are as shipped.
 */

/** The bindings in force, set by the game whenever the settings change. */
export const keyBindings = signal<Bindings>(DEFAULT_BINDINGS);

export function setKeyBindings(bindings: Bindings): void {
  keyBindings.value = bindings;
}

const SHORT: Record<string, string> = {
  Mouse0: 'LMB',
  Mouse1: 'MMB',
  Mouse2: 'RMB',
  ShiftLeft: 'Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R Alt',
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  Backspace: 'Backspace',
};

/** A key's name short enough for a chip or a prompt: "F", "LMB", "Shift", "Up arrow". */
export function shortKey(code: string): string {
  return SHORT[code] ?? codeLabel(code);
}

/** The name of the key `action` is on in `context` now, or its default if it's unbound. */
export function keyName(
  action: Action,
  context: InputContext = 'sailing',
  bindings: Bindings = keyBindings.value,
): string {
  const code = bindings[context][action]?.[0] ?? DEFAULT_BINDINGS[context][action]?.[0];
  return code ? shortKey(code) : '?';
}

/** Default key letter → the action it stands for in `context`, for the letters prompts use. */
function defaultLetters(context: InputContext): Map<string, Action> {
  const out = new Map<string, Action>();
  for (const [action, codes] of Object.entries(DEFAULT_BINDINGS[context]) as [
    Action,
    readonly string[],
  ][]) {
    const code = codes[0];
    if (code && /^Key[A-Z]$/.test(code) && !out.has(code.slice(3))) out.set(code.slice(3), action);
  }
  return out;
}

const LETTERS: Partial<Record<InputContext, Map<string, Action>>> = {};

/**
 * A key letter where the prompts put one: at the start, after "·", "(", ",", ":", "." or
 * "or", or after "hold" or "press"; followed by a space, ")", ",", "/" or the end. A and I
 * are left alone, since they're words.
 */
const KEY_IN_TEXT = /(^|[·(,:.]\s*|\bor\s|\b[Hh]old\s|\b[Pp]ress\s)([B-HJ-Z])(?=$|[\s),/])/g;

/**
 * `text` with every default key letter whose action has been rebound in `context` swapped
 * for the key it's on now. Unchanged when nothing's rebound.
 */
export function keyText(
  text: string,
  context: InputContext = 'sailing',
  bindings: Bindings = keyBindings.value,
): string {
  if (bindings === DEFAULT_BINDINGS) return text;
  const letters = (LETTERS[context] ??= defaultLetters(context));
  return text.replace(KEY_IN_TEXT, (whole, lead: string, letter: string) => {
    const action = letters.get(letter);
    if (!action) return whole;
    const now = bindings[context][action]?.[0];
    if (!now || now === `Key${letter}`) return whole;
    return `${lead}${shortKey(now)}`;
  });
}
