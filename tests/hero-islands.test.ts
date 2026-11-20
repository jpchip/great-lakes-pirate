import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { buildAshoreScene } from '../src/gameplay/onfoot/ashore-scene';
import { guardWitness } from '../src/gameplay/onfoot/foot-law';
import { createIslandWatch } from '../src/gameplay/onfoot/island-watch';
import {
  ownName,
  residentLine,
  residentName,
  residentsAbout,
  residentSpawns,
  LocalNavs,
} from '../src/gameplay/onfoot/residents';
import { gameLaw } from '../src/sim/law/defs';
import { commitCrime } from '../src/sim/law/law';
import { createLawState } from '../src/sim/law/state';
import { ISLANDS, placeZoneIslands, type PlacedIsland } from '../src/sim/islands/on-foot';
import type { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import { manifestFrame } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';
import npcTypes from '../data/npc_types.json';

/**
 * Phase 9 piece Q (plan 11 §18.17): the hero islands walked whole. Madeline with La Pointe,
 * Hermit, Basswood, Devils, Sand, Outer and Raspberry: their POIs, landings and residents
 * on the baked terrain, and the residents seeing and reporting as townsfolk.
 */

const HERO = [
  'island.madeline',
  'island.hermit',
  'island.basswood',
  'island.devils',
  'island.sand',
  'island.outer',
  'island.raspberry',
];
const HOUR = 3600;
const NOON = 12 * HOUR;
const MIDNIGHT = 24 * HOUR + 0.5 * HOUR;

describe('islands.json: the hero islands', () => {
  it('each is a hero with POIs and a landing, and its people within the budget', () => {
    for (const id of HERO) {
      const def = ISLANDS.find((i) => i.id === id);
      expect(def?.tier, id).toBe('hero');
      expect(def?.onFoot?.pois.length, id).toBeGreaterThan(1);
      expect(def?.onFoot?.landings.length, id).toBeGreaterThan(0);
      // ≤ 6 people with the station's keeper.
      expect(def?.onFoot?.residents.length ?? 0, id).toBeLessThanOrEqual(5);
      for (const r of def?.onFoot?.residents ?? []) {
        expect(r.home !== undefined || r.round.length > 0, r.id).toBe(true);
      }
    }
  });

  it('Madeline keeps La Pointe as its village, with the trading post', () => {
    const v = ISLANDS.find((i) => i.id === 'island.madeline')?.onFoot?.village;
    expect(v).toMatchObject({ harbor: 'harbor.la_pointe', port: 'port.la_pointe' });
  });

  it('keeps cave mouths closed: no hunting, digging or hideouts in piece Q', () => {
    for (const id of HERO) {
      const def = ISLANDS.find((i) => i.id === id);
      expect(def?.onFoot?.caches, id).toEqual([]);
      expect(
        def?.onFoot?.pois.some((p) => p.poi === 'poi.dig_spot'),
        id,
      ).toBe(false);
    }
  });

  it('the residents are townsfolk who report, never chase', () => {
    for (const t of ['npc.fisherman', 'npc.farmer', 'npc.villager']) {
      const def = (npcTypes.types as { id: string; witness: string; pursues: boolean }[]).find(
        (n) => n.id === t,
      );
      expect(def?.witness, t).toBe('townsfolk');
      expect(def?.pursues, t).toBe(false);
    }
  });

  it('names and lines', () => {
    expect(residentName({ kind: 'fisherman', name: 'Gus Lindquist' })).toBe(
      'the fisherman, Gus Lindquist',
    );
    expect(ownName('the fisherman, Gus Lindquist')).toBe('Gus Lindquist');
    expect(residentLine({ talk: ['a', 'b', 'c'] }, 4)).toBe('b');
    expect(residentLine({ talk: ['a', 'b', 'c'] }, -1)).toBe('c');
  });

  it('a dead resident stays dead, one out cold is about again later', () => {
    const r = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as unknown as PlacedIsland['residents'];
    const about = residentsAbout(r, { a: { diedAt: 5 }, b: { downUntil: 100 } }, 50);
    expect(about.map((x) => x.id)).toEqual(['c']);
    expect(residentsAbout(r, { a: { diedAt: 5 }, b: { downUntil: 100 } }, 150)).toHaveLength(2);
  });

  it("a townsman's report goes as fast as word leaves his island", () => {
    const defs = gameLaw();
    const eta = (reporting: 'fast' | 'slow', t: number): number => {
      const w = {
        law: createLawState('ship.t1_schooner', 'Wren', 0),
        standing: {},
        seed: 'test',
      };
      commitCrime(
        defs,
        w,
        {
          crime: 'crime.trespass',
          region: 'region.apostles',
          witnesses: [
            { id: 'resident.x', kind: 'townsfolk', name: 'x', identification: 'person', reporting },
          ],
        },
        t,
      );
      return (w.law.reports.inProgress[0]?.eta ?? 0) - t;
    };
    expect(eta('fast', NOON)).toBeLessThanOrEqual(1.5 * HOUR);
    // Slow: rows across at dawn.
    expect(eta('slow', MIDNIGHT)).toBeGreaterThanOrEqual(5 * HOUR);
  });
});

const dir = join(__dirname, '..', 'public', 'world', 'apostles');
const baked = existsSync(join(dir, 'manifest.json'));

describe('the hero islands on the baked terrain', () => {
  let zone: LoadedZone;
  let placed: PlacedIsland[];
  const read = async (path: string) => new Uint8Array(readFileSync(join(dir, path)));
  beforeAll(async () => {
    if (!baked) return;
    zone = await loadZoneTerrain(read);
    placed = placeZoneIslands(
      zone.manifest.zone,
      zone.manifest.islands ?? [],
      (x, z) => zone.terrain.heightAt(x, z),
      manifestFrame(zone.manifest),
    ).filter((i) => HERO.includes(i.id));
  });

  it.skipIf(!baked)('places all seven, each landing at the water and lived-in homes lit', () => {
    expect(placed.map((i) => i.id).sort()).toEqual([...HERO].sort());
    for (const i of placed) {
      expect(i.land, i.id).toBeDefined();
      for (const l of i.landings) {
        let wet = false;
        for (let a = 0; a < 32 && !wet; a++) {
          for (const r of [10, 25, 40, 60]) {
            const x = l.x + Math.sin((a / 32) * Math.PI * 2) * r;
            const z = l.z - Math.cos((a / 32) * Math.PI * 2) * r;
            if (zone.terrain.heightAt(x, z) <= 0) wet = true;
          }
        }
        expect(wet, `${i.id} ${l.name}`).toBe(true);
      }
      if (i.residents.some((r) => r.home)) {
        expect(
          i.pieces.some((p) => p.lit),
          i.id,
        ).toBe(true);
      }
    }
  });

  it.skipIf(!baked)(
    'each landing builds its own island, the residents out by day and indoors by night',
    () => {
      const state = createWorldState('hero-test');
      const ashore = attachIslandAshore({
        state,
        heightAt: (x, z) => zone.terrain.heightAt(x, z),
        grid: () => ({
          x0: zone.terrain.height.x0,
          z0: zone.terrain.height.z0,
          step: zone.terrain.height.step,
        }),
        islands: () => placed,
        // Each island's tiles' extent (all the scene needs of them here).
        ground: (id) => {
          const m = zone.manifest.islands?.find((k) => k.id === id);
          return m
            ? ({
                x0: m.x0,
                z0: m.z0,
                step: 1,
                maxX: m.x0 + m.width - 1,
                maxZ: m.z0 + m.height - 1,
              } as GridField)
            : undefined;
        },
        runSeed: () => 7,
        notice: () => undefined,
      });
      for (const i of placed) {
        for (const l of i.landings) {
          expect(ashore.sceneFor(l)?.island, `${i.id} ${l.name}`).toBe(i.id);
        }
        if (!i.residents.length) continue;
        const l = i.landings[0];
        const s = l && ashore.sceneFor(l);
        if (!s || !l) throw new Error(i.id);
        const scene = buildAshoreScene({
          ground: s.ground,
          center: l,
          box: s.box,
          extra: s.extra,
          ladders: s.ladders,
        });
        const watchAt = (t: number) =>
          createIslandWatch({
            island: i,
            scene,
            tier: 0,
            seed: 'hero',
            pockets: state.player,
            fates: () => (state.residents ??= {}),
            hooks: { notice: () => undefined },
            conditions: () => ({
              gameSeconds: t,
              cloud01: 0,
              fogM: 5000,
              rain01: 0,
              wantedTier: 0,
              fame01: 0,
            }),
          });
        const day = watchAt(NOON);
        // Every resident's round snaps to ground he can stand on.
        expect(day.stealth.guards.length, i.id).toBe(i.residents.length);
        const g = day.stealth.guards[0];
        if (!g) throw new Error(i.id);
        expect(guardWitness(g, 'person', i.reporting)).toMatchObject({
          kind: 'townsfolk',
          reporting: i.reporting,
        });
        expect(watchAt(MIDNIGHT).stealth.guards, i.id).toHaveLength(0);
        expect(residentSpawns(i.residents, new LocalNavs([]), true)).toEqual([]);
      }
    },
    60000,
  );
});
