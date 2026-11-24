import { describe, expect, it } from 'vitest';
import {
  isTouchOnly,
  MOBILE_WARNING_KEY,
  rememberMobileDismissed,
  shouldWarnMobile,
  type PointerEnv,
} from '../src/core/device-fit';

const phone: PointerEnv = { primaryCoarse: true, anyFine: false, anyHover: false, touchPoints: 5 };
const desktop: PointerEnv = { primaryCoarse: false, anyFine: true, anyHover: true, touchPoints: 0 };
const touchLaptop: PointerEnv = {
  primaryCoarse: false,
  anyFine: true,
  anyHover: true,
  touchPoints: 10,
};
const ipadWithTrackpad: PointerEnv = {
  primaryCoarse: true,
  anyFine: true,
  anyHover: true,
  touchPoints: 5,
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

describe('mobile warning', () => {
  it('flags only a finger-only device', () => {
    expect(isTouchOnly(phone)).toBe(true);
    expect(isTouchOnly(desktop)).toBe(false);
    expect(isTouchOnly(touchLaptop)).toBe(false);
    expect(isTouchOnly(ipadWithTrackpad)).toBe(false);
  });

  it('is remembered once dismissed', () => {
    const storage = memoryStorage();
    expect(shouldWarnMobile(phone, storage)).toBe(true);
    rememberMobileDismissed(storage);
    expect(storage.getItem(MOBILE_WARNING_KEY)).toBe('1');
    expect(shouldWarnMobile(phone, storage)).toBe(false);
  });

  it('still warns without storage, and never on a desktop', () => {
    expect(shouldWarnMobile(phone, undefined)).toBe(true);
    expect(shouldWarnMobile(desktop, undefined)).toBe(false);
  });
});
