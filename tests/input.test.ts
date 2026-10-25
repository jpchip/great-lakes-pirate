import { describe, expect, it } from 'vitest';
import { InputMapper } from '../src/core/input';

function key(type: string, code: string): Event {
  return Object.assign(new Event(type), { code });
}

describe('InputMapper', () => {
  it('maps keys to actions in the active context', () => {
    const target = new EventTarget();
    const input = new InputMapper();
    input.attach(target);
    input.context = 'sailing';

    target.dispatchEvent(key('keydown', 'KeyA'));
    expect(input.isDown('SteerPort')).toBe(true);
    expect(input.pressed('SteerPort')).toBe(true);

    input.endTick();
    expect(input.isDown('SteerPort')).toBe(true);
    expect(input.pressed('SteerPort')).toBe(false);

    // The same key means something else on foot.
    input.context = 'onFoot';
    expect(input.isDown('MoveLeft')).toBe(true);
    expect(input.isDown('SteerPort')).toBe(false);

    target.dispatchEvent(key('keyup', 'KeyA'));
    expect(input.isDown('MoveLeft')).toBe(false);
  });

  it('ignores key repeat for pressed() and honours rebinding', () => {
    const target = new EventTarget();
    const input = new InputMapper({
      menu: {},
      sailing: { Fire: ['KeyZ'] },
      onFoot: {},
      chart: {},
    });
    input.attach(target);
    input.context = 'sailing';
    target.dispatchEvent(key('keydown', 'KeyZ'));
    input.endTick();
    target.dispatchEvent(key('keydown', 'KeyZ'));
    expect(input.pressed('Fire')).toBe(false);
    expect(input.isDown('Fire')).toBe(true);
  });

  it('releases everything on blur and detach', () => {
    const target = new EventTarget();
    const input = new InputMapper();
    input.attach(target);
    input.context = 'sailing';
    target.dispatchEvent(key('keydown', 'KeyW'));
    target.dispatchEvent(new Event('blur'));
    expect(input.isDown('RaiseSail')).toBe(false);
    input.detachListeners();
    target.dispatchEvent(key('keydown', 'KeyW'));
    expect(input.isDown('RaiseSail')).toBe(false);
  });
});
