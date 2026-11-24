import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, rebind } from '../src/core/input';
import { keyName, keyText, shortKey } from '../src/ui/keys';

/** The keys named on screen follow the bindings (plan 13 §9). */

describe('key names on screen', () => {
  it('leaves every prompt alone while the keys are as shipped', () => {
    for (const t of ['F board her', 'Hold F to look her over', 'A ship on the horizon']) {
      expect(keyText(t, 'sailing', DEFAULT_BINDINGS)).toBe(t);
    }
  });

  it('swaps a rebound key wherever the prompts name it', () => {
    const b = rebind(DEFAULT_BINDINGS, 'sailing', 'Interact', 'KeyE');
    expect(keyText('F board her', 'sailing', b)).toBe('E board her');
    expect(keyText('Hold F to look her over', 'sailing', b)).toBe('Hold E to look her over');
    expect(keyText('F look her over · H hail', 'sailing', b)).toBe('E look her over · H hail');
    expect(keyText('Anchor or tie up first (X, or F at a berth)', 'sailing', b)).toBe(
      'Anchor or tie up first (X, or E at a berth)',
    );
    expect(keyText('capture means the rope. F again to dock', 'sailing', b)).toBe(
      'capture means the rope. E again to dock',
    );
  });

  it('only touches key letters, not words or letters inside words', () => {
    const b = rebind(
      rebind(DEFAULT_BINDINGS, 'sailing', 'SteerPort', 'KeyJ'),
      'sailing',
      'Hail',
      'KeyY',
    );
    expect(keyText('A ship lies to (H to hail)', 'sailing', b)).toBe('A ship lies to (Y to hail)');
    expect(keyText('Hollister Hardware', 'sailing', b)).toBe('Hollister Hardware');
    expect(keyText('The R.G. Stewart', 'sailing', b)).toBe('The R.G. Stewart');
  });

  it('reads each context on its own: C is the shot at the helm and crouch on foot', () => {
    const b = rebind(DEFAULT_BINDINGS, 'onFoot', 'Crouch', 'ControlLeft');
    expect(keyText('C crouch', 'onFoot', b)).toBe('Ctrl crouch');
    expect(keyText('C changes the shot', 'sailing', b)).toBe('C changes the shot');
  });

  it('names keys short enough for a chip', () => {
    expect(keyName('Fire', 'sailing', DEFAULT_BINDINGS)).toBe('LMB');
    expect(keyName('AimMode', 'sailing', DEFAULT_BINDINGS)).toBe('Tab');
    expect(keyName('Sprint', 'onFoot', DEFAULT_BINDINGS)).toBe('Shift');
    expect(shortKey('Digit2')).toBe('2');
    const b = rebind(DEFAULT_BINDINGS, 'sailing', 'GoAshore', 'Mouse3');
    expect(keyName('GoAshore', 'sailing', b)).toBe('Mouse 4');
  });
});
