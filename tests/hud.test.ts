import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { createSailingState } from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import { bestAngleBand, clockLabel, sampleHud, weekLabel } from '../src/ui/hud/model';

const DEG = Math.PI / 180;
const t1 = (): ReturnType<typeof compileSailingClass> =>
  compileSailingClass(sailShipRecord(T1_SCHOONER_ID), defaultHandling());

describe('sailing HUD model', () => {
  it('puts the gold band where the T1 polar is within 5% of its best', () => {
    const band = bestAngleBand(t1());
    // The polar peaks at 1.0 from 120° to 135°; 90° is 0.95.
    expect(band.fromDeg).toBeGreaterThanOrEqual(85);
    expect(band.fromDeg).toBeLessThanOrEqual(95);
    expect(band.toDeg).toBeGreaterThanOrEqual(135);
    expect(band.toDeg).toBeLessThanOrEqual(150);
  });

  it('writes the week and the clock in the 1900 calendar', () => {
    expect(weekLabel(0)).toBe('Wk of May 7, 1900');
    // Each game day is one calendar week.
    expect(weekLabel(4 * SECONDS_PER_GAME_DAY + 3600)).toBe('Wk of Jun 4, 1900');
    expect(clockLabel(19.5 * 3600)).toBe('19:30');
    expect(clockLabel(SECONDS_PER_GAME_DAY + 7 * 3600 + 5 * 60)).toBe('07:05');
  });

  it('reads heading, wind, sails and depth off the ship and the terrain', () => {
    const cls = t1();
    const state = createSailingState(10, 20, 270 * DEG);
    state.windAngle = -60 * DEG;
    state.windKn = 14;
    state.sailLevel = 3;
    state.sailSetting = 2;
    state.riggingCondition = 0.6;
    const terrain = {
      contains: () => true,
      depthAt: () => 4.2,
    } as unknown as Parameters<typeof sampleHud>[0]['terrain'];
    const hud = sampleHud({
      ship: { sailing: { cls, state } },
      terrain,
      gameSeconds: 12 * 3600,
      draftM: 1.5,
    });
    expect(hud).toBeDefined();
    if (!hud) return;
    expect(hud.headingDeg).toBeCloseTo(270);
    expect(hud.windAngleDeg).toBeCloseTo(-60);
    expect(hud.noGoDeg).toBeCloseTo(40);
    expect(hud.sailOrdered).toBe('Full');
    expect(hud.sailSet).toBe('Half');
    expect(hud.rigging01).toBe(0.6);
    expect(hud.hull01).toBeUndefined();
    expect(hud.strain01).toBeUndefined();
    expect(hud.depthM).toBe(4.2);
    expect(hud.timeText).toBe('12:00');

    // Damage readouts come from the hazards piece when it's wired in.
    const damaged = sampleHud({
      ship: { sailing: { cls, state } },
      terrain: undefined,
      gameSeconds: 0,
      draftM: 1.5,
      damage: () => ({ hull01: 0.4, strain01: 0.7 }),
    });
    expect(damaged?.hull01).toBe(0.4);
    expect(damaged?.strain01).toBe(0.7);
    expect(damaged?.depthM).toBeUndefined();
    expect(sampleHud({ ship: {}, terrain: undefined, gameSeconds: 0, draftM: 1 })).toBeUndefined();
  });
});
