import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, InputMapper, REBINDABLE, rebind } from '../src/core/input';
import { defaultSettings, parseSettings } from '../src/core/settings';
import { flashAt, GENTLE_PEAK, gentleFlashAt } from '../src/render/atmosphere/lightning';

/** Accessibility (plan 13 §9): the settings, hold vs. toggle, rebinding and gentle flashes. */

function key(type: string, code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe('accessibility settings', () => {
  it('defaults to the game as authored, and an old settings file gains them', () => {
    const a = defaultSettings().access;
    expect(a).toEqual({
      uiScale: 1,
      plainFont: false,
      colorMode: 'off',
      reduceMotion: false,
      gentleFlashes: false,
      brightness: 1,
      crouchToggle: false,
      runToggle: false,
      holdToAim: false,
    });
    expect(parseSettings({ camera: { rollWithShip: true } }).access).toEqual(a);
  });

  it('keeps what was chosen and throws out what is out of range', () => {
    const s = parseSettings({
      access: { uiScale: 1.3, plainFont: true, colorMode: 'redGreen', brightness: 9 },
    });
    expect(s.access.uiScale).toBe(1.3);
    expect(s.access.plainFont).toBe(true);
    expect(s.access.colorMode).toBe('redGreen');
    expect(s.access.brightness).toBe(1);
    expect(parseSettings({ access: { colorMode: 'sepia' } }).access.colorMode).toBe('off');
  });
});

describe('hold vs. toggle', () => {
  it('latches a toggled action on one press and lets it go on the next', () => {
    const target = new EventTarget();
    const input = new InputMapper();
    input.attach(target);
    input.context = 'onFoot';
    input.setToggle('Crouch', true);
    target.dispatchEvent(key('keydown', 'KeyC'));
    target.dispatchEvent(key('keyup', 'KeyC'));
    input.endTick();
    expect(input.isDown('Crouch')).toBe(true);
    // Key repeat while held doesn't flip it.
    target.dispatchEvent(key('keydown', 'KeyC'));
    target.dispatchEvent(key('keydown', 'KeyC'));
    expect(input.isDown('Crouch')).toBe(false);
    target.dispatchEvent(key('keyup', 'KeyC'));
    expect(input.isDown('Crouch')).toBe(false);
    // Run is still held, not toggled.
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    expect(input.isDown('Sprint')).toBe(true);
    target.dispatchEvent(key('keyup', 'ShiftLeft'));
    expect(input.isDown('Sprint')).toBe(false);
  });

  it('lets a latched action go when the context changes or the toggle is turned off', () => {
    const target = new EventTarget();
    const input = new InputMapper();
    input.attach(target);
    input.context = 'onFoot';
    input.setToggle('Sprint', true);
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    target.dispatchEvent(key('keyup', 'ShiftLeft'));
    expect(input.isDown('Sprint')).toBe(true);
    input.context = 'sailing';
    input.context = 'onFoot';
    expect(input.isDown('Sprint')).toBe(false);
    target.dispatchEvent(key('keydown', 'ShiftLeft'));
    input.setToggle('Sprint', false);
    expect(input.isDown('Sprint')).toBe(true);
  });
});

describe('full key rebinding', () => {
  it('offers the keys on foot and on the chart as well as at the helm', () => {
    expect(REBINDABLE.onFoot).toContain('Crouch');
    expect(REBINDABLE.onFoot).toContain('Interact');
    expect(REBINDABLE.chart).toContain('Cancel');
    for (const ctx of ['sailing', 'onFoot', 'chart'] as const) {
      for (const action of REBINDABLE[ctx] ?? []) {
        expect(DEFAULT_BINDINGS[ctx][action], `${ctx}.${action}`).toBeDefined();
      }
    }
  });

  it('rebinds on foot without touching the helm', () => {
    const b = rebind(DEFAULT_BINDINGS, 'onFoot', 'Crouch', 'ControlLeft');
    expect(b.onFoot.Crouch).toEqual(['ControlLeft']);
    expect(b.sailing).toBe(DEFAULT_BINDINGS.sailing);
  });
});

describe('gentle lightning', () => {
  it('stays dim, has one peak and no fast flicker', () => {
    let peak = 0;
    let peaks = 0;
    let prev = 0;
    let rising = true;
    for (let t = 0; t <= 1.3; t += 0.01) {
      const f = gentleFlashAt(t);
      peak = Math.max(peak, f);
      if (rising && f < prev) {
        peaks++;
        rising = false;
      } else if (!rising && f > prev) rising = true;
      prev = f;
    }
    expect(peak).toBeLessThanOrEqual(GENTLE_PEAK + 1e-9);
    expect(peaks).toBe(1);
    // The authored flash is a double stroke at full strength.
    expect(flashAt(0)).toBe(1);
  });
});
