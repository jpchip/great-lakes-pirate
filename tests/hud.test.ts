import { loadingScreen } from '../src/ui/loading/model';
import { describe, expect, it } from 'vitest';
import { SECONDS_PER_GAME_DAY } from '../src/core/time';
import { createSailingState } from '../src/sim/sailing/controller';
import { defaultHandling } from '../src/sim/sailing/handling';
import { defaultHazardRules } from '../src/sim/sailing/hazard-rules';
import { compileHazardClass, createHazardState } from '../src/sim/sailing/hazards';
import { compileSailingClass } from '../src/sim/sailing/ship-class';
import { sailShipRecord, T1_SCHOONER_ID } from '../src/sim/sailing/ships';
import {
  barometerSnapshot,
  bestAngleBand,
  anchorRefusedNotice,
  clockLabel,
  dockRefusedNotice,
  sampleHud,
  weekLabel,
} from '../src/ui/hud/model';

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

  it('reads the barometer in inches of mercury with a trend arrow', () => {
    const baro = barometerSnapshot({ hpa: 1013.25, tendency3h: -3.4, trend: 'falling fast' });
    expect(baro.inHgText).toBe('29.92');
    expect(baro.arrow).toBe('⬇');
    expect(barometerSnapshot({ hpa: 998, tendency3h: 0.2, trend: 'steady' }).arrow).toBe('→');
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
    expect(hud.shallow).toBe(true);
    expect(hud.status).toEqual([]);
    expect(hud.timeText).toBe('12:00');

    // With the hazards component, the pools, strain, depth and states come from it.
    const record = sailShipRecord(T1_SCHOONER_ID);
    const hcls = compileHazardClass(record, defaultHazardRules());
    const hstate = createHazardState(hcls);
    hstate.hull = hcls.hullHP * 0.4;
    hstate.strain = 0.7;
    hstate.depth = 3.1;
    hstate.shallow = true;
    hstate.aground = true;
    hstate.anchor = 'down';
    const damaged = sampleHud({
      ship: { sailing: { cls, state }, hazards: { cls: hcls, state: hstate } },
      terrain: undefined,
      gameSeconds: 0,
      draftM: 1.5,
    });
    expect(damaged?.hull01).toBeCloseTo(0.4);
    expect(damaged?.rigging01).toBe(1);
    expect(damaged?.strain01).toBe(0.7);
    expect(damaged?.depthM).toBe(3.1);
    expect(damaged?.shallow).toBe(true);
    expect(damaged?.status).toEqual(['Aground: hold X to kedge', 'Anchored']);

    // A refused order adds its chip, once.
    const refused = sampleHud({
      ship: { sailing: { cls, state }, hazards: { cls: hcls, state: hstate } },
      terrain: undefined,
      gameSeconds: 0,
      draftM: 1.5,
      notice: dockRefusedNotice('noBerth'),
    });
    expect(refused?.status).toEqual(['Aground: hold X to kedge', 'Anchored', 'No berth in reach']);
    expect(dockRefusedNotice('tooFast')).toBe('Too fast to dock');
    expect(anchorRefusedNotice('tooDeep')).toBe('Too deep to anchor');
    expect(sampleHud({ ship: {}, terrain: undefined, gameSeconds: 0, draftM: 1 })).toBeUndefined();
  });

  it('warns near the soft zone edge', () => {
    const cls = t1();
    const terrain = {
      bounds: { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 },
      contains: () => true,
      depthAt: () => 30,
    } as unknown as Parameters<typeof sampleHud>[0]['terrain'];
    const edge = { fogFadeM: 400, edgeVisibilityM: 300 };
    const at = (x: number) =>
      sampleHud({
        ship: { sailing: { cls, state: createSailingState(x, 0, 0) } },
        terrain,
        gameSeconds: 0,
        draftM: 1.5,
        edge,
      })?.atEdge;
    // Out in the fog the HUD offers the chart (Phase 3 piece D).
    expect(at(0)).toBe(false);
    expect(at(750)).toBe(false);
    expect(at(850)).toBe(true);
  });
});

describe('loading screen (Phase 3 piece A)', () => {
  it('names the place and how the ship comes in', () => {
    expect(
      loadingScreen('Apostle Islands', {
        kind: 'entry',
        entryName: 'North of Bear Island, from the open lake',
      }),
    ).toEqual({
      title: 'Apostle Islands',
      line: 'Out of the fog, north of Bear Island.',
    });
    expect(loadingScreen('Apostle Islands', { kind: 'return' }).title).toBe('Apostle Islands');
  });
});
