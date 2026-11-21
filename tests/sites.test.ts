/* eslint-disable @typescript-eslint/no-non-null-assertion -- test lookups of data the file itself checks */
// Phase 9 piece W (plan 11 §18.4; plan 09 §2): the seven hideout sites. The five new ones
// set down on their baked zones (their set pieces flattened as the zone loads), every
// background starting at its own, claiming a site by building on it, and Minnesota Point's
// lease or squat. The bake checks skip when a zone isn't checked out (LFS pointers only).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import backgroundsJson from '../data/backgrounds.json';
import { ChartProjection, chartToZone, type Zone } from '../src/core/coords';
import { siteSightM } from '../src/gameplay/discovery';
import { attachHideouts } from '../src/gameplay/hideouts';
import { attachIslandAshore } from '../src/gameplay/island-ashore';
import { createNewRun } from '../src/sim/character/new-run';
import { SITE_SIGHT_M } from '../src/sim/discovery/discovery';
import { BuildGrid, unpackGrid } from '../src/sim/hideouts/grid';
import {
  buildSiteOf,
  inSiteBounds,
  siteFootprint,
  siteFrame,
  zoneToSite,
} from '../src/sim/hideouts/site-frame';
import {
  claimSite,
  hasStrongbox,
  leaseSite,
  siteAnchorage,
  siteDef,
  SITES,
  squatsNoticed,
  starterLayout,
  startingHideouts,
  storageCapacity,
} from '../src/sim/hideouts/stash';
import { canPlace, cellDepth } from '../src/sim/hideouts/validity';
import { placeZoneIslands } from '../src/sim/islands/on-foot';
import { placeZoneCaves } from '../src/sim/caves/caves';
import { LEGENDS, legendSpotGeo } from '../src/sim/legends/legends';
import { flattenUnbaked } from '../src/sim/terrain/edits';
import { GridField } from '../src/sim/terrain/grid-field';
import { loadZoneTerrain, type LoadedZone } from '../src/sim/terrain/load';
import type { ZoneManifest } from '../src/sim/terrain/manifest';
import type { ZoneTerrain } from '../src/sim/terrain/zone-terrain';
import { manifestFrame, setPieceFootprint, spawnPose, zoneDef } from '../src/sim/terrain/zones';
import { createWorldState } from '../src/sim/world-state';

const projection = new ChartProjection();
const NEW_SITES = [
  'site.hermit',
  'site.devils',
  'site.outer',
  'site.minnesota_point',
  'site.north_shore',
] as const;

const dirOf = (zoneId: string) =>
  join(__dirname, '..', 'public', 'world', zoneId.replace(/^zone\./, ''));
const baked = (zoneId: string): boolean => {
  const dir = dirOf(zoneId);
  return (
    existsSync(join(dir, 'manifest.json')) &&
    readFileSync(join(dir, 'height', '0-0.bin')).byteLength > 200
  );
};
const zones = new Map<string, Promise<LoadedZone>>();
const loadZone = (zoneId: string): Promise<LoadedZone> => {
  let z = zones.get(zoneId);
  if (!z) {
    const dir = dirOf(zoneId);
    z = loadZoneTerrain(async (p) => new Uint8Array(readFileSync(join(dir, p))));
    zones.set(zoneId, z);
  }
  return z;
};

/** Water a T1 can sail (2.5 m), flood-filled on an 8 m grid from `from`. */
function sailable(terrain: ZoneTerrain, from: Zone): (p: Zone) => boolean {
  const step = 8;
  const { minX, minZ, maxX, maxZ } = terrain.bounds;
  const w = Math.floor((maxX - minX) / step) + 1;
  const h = Math.floor((maxZ - minZ) / step) + 1;
  const seen = new Uint8Array(w * h);
  const cell = (p: Zone) => [Math.round((p.x - minX) / step), Math.round((p.z - minZ) / step)];
  const ok = (i: number, j: number) => terrain.heightAt(minX + i * step, minZ + j * step) <= -2.5;
  const [si = 0, sj = 0] = cell(from);
  const stack = [sj * w + si];
  seen[sj * w + si] = 1;
  while (stack.length) {
    const k = stack.pop() ?? 0;
    const i = k % w;
    const j = (k - i) / w;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nk = nj * w + ni;
      if (seen[nk] || !ok(ni, nj)) continue;
      seen[nk] = 1;
      stack.push(nk);
    }
  }
  return (p) => {
    const [i = 0, j = 0] = cell(p);
    return seen[j * w + i] === 1;
  };
}

describe('the seven sites (plan 09 §2.1)', () => {
  it('has the five new sites with their set pieces, regions and traits', () => {
    expect(SITES).toHaveLength(7);
    const region = Object.fromEntries(SITES.map((s) => [s.id, s.wantedRegion]));
    expect(region).toMatchObject({
      'site.hermit': 'region.apostles',
      'site.devils': 'region.apostles',
      'site.outer': 'region.apostles',
      'site.minnesota_point': 'region.duluth',
      'site.north_shore': 'region.north_shore',
    });
    for (const id of NEW_SITES) {
      const s = siteDef(id)!;
      const piece = zoneDef(s.zone).setPieces.find((p) => p.id === s.setPiece);
      expect(piece?.site, id).toBe(id);
      // The bounds lie inside the set piece's flattened footprint.
      const b = s.build!;
      expect(b.alongM, id).toBeGreaterThanOrEqual(-piece!.alongM / 2);
      expect(b.alongM + b.cols * 2, id).toBeLessThanOrEqual(piece!.alongM / 2);
      expect(b.inlandM + b.rows * 2, id).toBeLessThanOrEqual(piece!.inlandM);
      expect(b.inlandM, id).toBeGreaterThanOrEqual(-piece!.seawardM);
    }
    // The Devils clifftop is the best hidden and the smallest; Minnesota Point the worst hidden.
    const conceal = SITES.map((s) => s.concealment);
    expect(siteDef('site.devils')!.concealment).toBe(Math.max(...conceal));
    expect(siteDef('site.minnesota_point')!.concealment).toBe(Math.min(...conceal));
    const area = (id: string) => siteDef(id)!.build!.cols * siteDef(id)!.build!.rows;
    expect(Math.min(...SITES.map((s) => area(s.id)))).toBe(area('site.devils'));
    // Hermit's quarry gives its brownstone, as Stockton's does.
    expect(siteDef('site.hermit')!.salvage?.good).toBe('good.brownstone');
    // Only Minnesota Point is owned, and it's leased or squatted.
    expect(SITES.filter((s) => s.claim === 'owned').map((s) => s.id)).toEqual([
      'site.minnesota_point',
    ]);
  });

  it('starts every background at its own site, and nobody at Hermit (plan 12 §2.2)', () => {
    const own: Record<string, string> = {
      deckhand: 'hideout.stockton',
      fisherman: 'hideout.outer',
      lumberjack: 'hideout.siskiwit',
      saloon_keeper: 'hideout.minnesota_point',
      ex_navy: 'hideout.north_shore',
      poacher: 'hideout.devils',
    };
    for (const b of backgroundsJson) {
      const key = b.id.replace(/^background\./, '');
      expect(b.hideout, key).toBe(own[key]);
      const run = createNewRun({
        name: 'Ida Bergquist',
        shipName: 'Kittiwake',
        background: key as 'deckhand',
        portrait: 'portrait.weathered',
        seed: 'abc12345',
      });
      expect(Object.keys(run.hideouts ?? {}), key).toEqual([own[key]]);
      const h = run.hideouts?.[own[key]!];
      // Pre-built: the shack's 40 CU and its strongbox.
      expect(storageCapacity(h!), key).toBe(40);
      expect(hasStrongbox(h!), key).toBe(true);
    }
    expect(siteDef('site.hermit')!.startFor).toEqual([]);
    // The Saloon Keeper starts with the light's lease in her name.
    expect(startingHideouts('saloon_keeper', 0)['hideout.minnesota_point']?.tenure).toBe('leased');
    expect(startingHideouts('poacher', 0)['hideout.devils']?.tenure).toBeUndefined();
  });

  it('sees a well hidden site only close in', () => {
    expect(siteSightM(0.3)).toBe(SITE_SIGHT_M);
    expect(siteSightM(0.6)).toBe(SITE_SIGHT_M);
    expect(siteSightM(0.7)).toBeLessThan(SITE_SIGHT_M);
    expect(siteSightM(0.85)).toBeLessThan(SITE_SIGHT_M / 4);
  });
});

describe('flattening a set piece the bake has not (piece W)', () => {
  const frame = { origin: { x: -274196, y: -55598 }, compression: 8 };
  const manifest = (edits: { id: string; kind: string }[]) =>
    ({ zone: 'zone.two_harbors', frame, handEdits: edits }) as unknown as ZoneManifest;

  it('flattens the land in a new set piece, and leaves a baked one alone', () => {
    const piece = zoneDef('zone.two_harbors').setPieces.find(
      (p) => p.id === 'setpiece.north_shore',
    )!;
    const m = manifest([{ id: 'setpiece.two_harbors', kind: 'flatten' }]);
    const fp = setPieceFootprint(piece, manifestFrame(m));
    const make = () => {
      const n = 81;
      const values = new Float32Array(n * n).fill(12);
      return new GridField(fp.anchor.x - 160, fp.anchor.z - 160, 4, n, n, values);
    };
    const g = make();
    expect(flattenUnbaked(m, g)).toEqual(['setpiece.north_shore']);
    expect(g.sample(fp.anchor.x, fp.anchor.z)).toBeCloseTo(piece.groundM, 3);
    // Far outside the footprint and its blend, untouched.
    expect(g.sample(fp.anchor.x - 150, fp.anchor.z - 150)).toBe(12);
    const again = make();
    const both = manifest([
      { id: 'setpiece.two_harbors', kind: 'flatten' },
      { id: 'setpiece.north_shore', kind: 'flatten' },
    ]);
    expect(flattenUnbaked(both, again)).toEqual([]);
    expect(again.sample(fp.anchor.x, fp.anchor.z)).toBe(12);
  });
});

for (const id of NEW_SITES) {
  const site = siteDef(id)!;
  describe.skipIf(!baked(site.zone))(`${id} on its baked zone`, () => {
    let zone: LoadedZone;
    beforeAll(async () => {
      zone = await loadZone(site.zone);
    });

    it('lays its shack (and pier) piece by piece as the rules allow', () => {
      const frame = siteFrame(site, siteFootprint(site, manifestFrame(zone.manifest))!);
      const build = buildSiteOf(frame, (x, z) => zone.terrain.heightAt(x, z));
      const g = new BuildGrid();
      for (const p of unpackGrid(starterLayout(id)).all()) {
        expect(canPlace(g, build, p.piece), `${p.piece.id} ${p.piece.col},${p.piece.row}`).toEqual({
          ok: true,
        });
        g.add(p.piece, true);
      }
      const box = g.all().find((p) => p.piece.id === 'build.strongbox')!;
      expect(cellDepth(build, box.piece.col, box.piece.row)).toBe(0);
      const post = g.all().find((p) => p.piece.id === 'build.mooring_post');
      if (site.pier)
        expect(cellDepth(build, post!.piece.col, post!.piece.row)).toBeGreaterThan(1.5);
      else expect(post).toBeUndefined();
    });

    it('has an anchorage a schooner can sail to, off the site', () => {
      const frame = manifestFrame(zone.manifest);
      const a = siteAnchorage(site, frame)!;
      expect(zone.terrain.heightAt(a.x, a.z)).toBeLessThan(-4);
      const reach = sailable(zone.terrain, spawnPose(zoneDef(site.zone)));
      expect(reach(a)).toBe(true);
    });

    it('keeps clear of the island’s prefabs, the caves and the legends’ spots', () => {
      const frame = siteFrame(site, siteFootprint(site, manifestFrame(zone.manifest))!);
      const h = (x: number, z: number) => zone.terrain.heightAt(x, z);
      const islands = placeZoneIslands(site.zone, zone.manifest.islands ?? [], h);
      const inside = (x: number, z: number, m = 2) => {
        const l = zoneToSite(frame, x, z);
        return inSiteBounds(frame, l.x, l.z, m);
      };
      for (const island of islands) {
        for (const p of island.pieces) expect(inside(p.x, p.z), `${p.poi} ${p.kind}`).toBe(false);
      }
      for (const cave of placeZoneCaves(
        site.zone,
        zone.manifest.islands ?? [],
        islands,
        manifestFrame(zone.manifest),
      )) {
        for (const n of cave.nodes) expect(inside(n.x, n.z, 6), cave.id).toBe(false);
      }
      for (const l of LEGENDS) {
        const g = legendSpotGeo(l);
        if (!g) continue;
        const at = chartToZone(projection.geoToChart(g), manifestFrame(zone.manifest));
        expect(inside(at.x, at.z, 4), l.id).toBe(false);
      }
    });
  });
}

describe('claiming a site (plan 09 §2.2)', () => {
  const hermit = siteDef('site.hermit')!;
  const point = siteDef('site.minnesota_point')!;

  it('claims an abandoned site free, empty, by the first thing built', () => {
    const hideouts = startingHideouts('deckhand', 0);
    const r = claimSite(hideouts, hermit, 500);
    expect(r).toMatchObject({ hideoutId: 'hideout.hermit', claimed: true });
    expect(r.state.tenure).toBeUndefined();
    expect(storageCapacity(r.state)).toBe(0);
    // A second claim is the same one.
    expect(claimSite(hideouts, hermit, 900).claimed).toBe(false);
    expect(hideouts['hideout.hermit']?.claimedAt).toBe(500);
  });

  it('leases Minnesota Point from the purse, or squats on it', () => {
    const hideouts = startingHideouts('deckhand', 0);
    const poor = { purse: 1_000 };
    expect(leaseSite(hideouts, point, poor, 0)).toEqual({
      ok: false,
      reason: 'Not enough in your purse',
    });
    expect(hideouts['hideout.minnesota_point']).toBeUndefined();
    // Built on without a lease, it's squatted.
    expect(claimSite(hideouts, point, 10).state.tenure).toBe('squatted');
    // A squat is noticed by its roll, heating Duluth.
    expect(squatsNoticed(hideouts, () => 0.01)).toEqual([
      { site: point, region: 'region.duluth', heat: point.lease!.squatHeat },
    ]);
    expect(squatsNoticed(hideouts, () => 0.99)).toEqual([]);
    // The lease makes it good, and nothing more is noticed.
    const rich = { purse: 50_000 };
    expect(leaseSite(hideouts, point, rich, 20)).toEqual({ ok: true, cents: point.lease!.cents });
    expect(rich.purse).toBe(50_000 - point.lease!.cents);
    expect(hideouts['hideout.minnesota_point']?.tenure).toBe('leased');
    expect(hideouts['hideout.minnesota_point']?.claimedAt).toBe(10);
    expect(squatsNoticed(hideouts, () => 0)).toEqual([]);
    expect(leaseSite(hideouts, point, rich, 30)).toMatchObject({ ok: false });
    expect(leaseSite(hideouts, hermit, rich, 30)).toMatchObject({ ok: false });
  });

  describe.skipIf(!baked('zone.twin_ports') || !baked('zone.apostles'))('in the game', () => {
    const setup = async (zoneId: string, background: 'deckhand' | 'saloon_keeper') => {
      const zone = await loadZone(zoneId);
      const state = createWorldState('claims');
      state.hideouts = startingHideouts(background, 0);
      state.player.purse = 40_000;
      const notices: string[] = [];
      const claims: string[] = [];
      const h = (x: number, z: number) => zone.terrain.heightAt(x, z);
      const hideouts = attachHideouts({
        state,
        zone: () => ({ id: zoneId, frame: manifestFrame(zone.manifest) }),
        heightAt: h,
        openStash: () => true,
        notice: (t) => notices.push(t),
        claimed: (site, hideout, how) => claims.push(`${site.id} ${hideout} ${how}`),
      });
      return { zone, state, hideouts, notices, claims, h };
    };

    it('opens a site nobody holds to build on, and the first piece claims it', async () => {
      const { zone, state, hideouts, claims } = await setup('zone.apostles', 'deckhand');
      const mid = centerOf(zone, 'site.hermit');
      const open = hideouts.sites().map((s) => s.hideoutId);
      expect(open).toEqual(['hideout.stockton']);
      const site = hideouts.openSiteAt(mid);
      expect(site?.hideoutId).toBe('hideout.hermit');
      expect(hideouts.siteAt(mid)).toBeUndefined();
      // An empty commit claims nothing.
      hideouts.commit('hideout.hermit', site!.grid.clone());
      expect(state.hideouts?.['hideout.hermit']).toBeUndefined();
      const g = site!.grid.clone();
      const shack = unpackGrid(starterLayout('site.hermit'));
      const first = shack.all()[0]!;
      g.add(first.piece, false);
      hideouts.commit('hideout.hermit', g);
      expect(state.hideouts?.['hideout.hermit']?.siteId).toBe('site.hermit');
      expect(claims).toEqual(['site.hermit hideout.hermit built']);
      expect(hideouts.siteAt(mid)?.hideoutId).toBe('hideout.hermit');
      expect(hideouts.openSiteAt(mid)).toBeUndefined();
    });

    it('offers Minnesota Point’s lease on its ground, and walks its pad from the anchorage', async () => {
      const { zone, state, hideouts, notices, claims, h } = await setup(
        'zone.twin_ports',
        'deckhand',
      );
      const mid = centerOf(zone, 'site.minnesota_point');
      const p = hideouts.prompt({ ...mid, y: h(mid.x, mid.z) });
      expect(p?.text).toBe('Lease the ground from the Lighthouse Board ($150)');
      p?.act();
      expect(state.hideouts?.['hideout.minnesota_point']?.tenure).toBe('leased');
      expect(state.player.purse).toBe(40_000 - 15_000);
      expect(claims).toEqual(['site.minnesota_point hideout.minnesota_point leased']);
      expect(notices.at(-1)).toMatch(/lease is yours/);
      expect(hideouts.prompt({ ...mid, y: h(mid.x, mid.z) })).toBeUndefined();
      // The point is mainland: a landing from the anchorage walks the zone's ground there.
      expect(hideouts.mainlandPads().map((x) => x.id)).toEqual(['site.minnesota_point']);
      const island = attachIslandAshore({
        state,
        heightAt: h,
        grid: () => ({
          x0: zone.terrain.height.x0,
          z0: zone.terrain.height.z0,
          step: zone.terrain.height.step,
        }),
        islands: () => [],
        ground: () => undefined,
        hideouts,
        sitePads: () => hideouts.mainlandPads(),
        runSeed: () => 7,
        notice: () => undefined,
      });
      const a = siteAnchorage(point, manifestFrame(zone.manifest))!;
      expect(island.walkableAt(a)).toBe(true);
      expect(island.sceneFor(a)?.island).toBe('site.minnesota_point');
    });

    it('lets the Saloon Keeper open her stash at the point', async () => {
      const { state, hideouts, h } = await setup('zone.twin_ports', 'saloon_keeper');
      expect(Object.keys(state.hideouts ?? {})).toEqual(['hideout.minnesota_point']);
      const box = hideouts.strongbox();
      expect(box?.hideout).toBe('hideout.minnesota_point');
      expect(h(box!.x, box!.z)).toBeGreaterThan(0.5);
      expect(hideouts.prompt({ x: box!.x + 1, y: box!.y, z: box!.z })?.text).toBe('Open the stash');
    });
  });
});

/** A site's bounds' middle in zone meters. */
function centerOf(zone: LoadedZone, siteId: string): { x: number; z: number } {
  const site = siteDef(siteId)!;
  const f = siteFrame(site, siteFootprint(site, manifestFrame(zone.manifest))!);
  return {
    x: f.origin.x + f.along.x * f.cols + f.inland.x * f.rows,
    z: f.origin.z + f.along.z * f.cols + f.inland.z * f.rows,
  };
}
