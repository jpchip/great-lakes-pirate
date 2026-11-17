import type { SiteDef } from '../../data/schemas/sites';
import type { PackedLayout } from '../../data/schemas/structures';
import type { ZoneFrame } from '../core/coords';
import { packGrid, unpackGrid, type BuildGrid, type BuildSite } from '../sim/hideouts/grid';
import { hideoutColliders, placedRender, type PlacedRender } from '../sim/hideouts/placed';
import {
  buildSiteOf,
  inSiteBounds,
  siteFootprint,
  siteFrame,
  siteToZone,
  zoneToSite,
  type SiteFrame,
} from '../sim/hideouts/site-frame';
import { hideoutIdOf, SITES, type HideoutState } from '../sim/hideouts/stash';
import { structure } from '../sim/hideouts/structures';
import type { WorldState } from '../sim/world-state';
import type { Collider } from './onfoot/colliders';

/**
 * The run's hideouts in the loaded zone (plan 09 §2–3, §10; Phase 8 piece C): each claimed
 * site set down on the zone by its frame, its grid unpacked from the save, its built pieces
 * as solids to walk on and around, and F at a storage piece or the strongbox opening its
 * storage. Phase 4's prefab shack, strongbox and shed are gone from the harbor data; this
 * is what stands there now.
 *
 * Grids are unpacked once per saved layout (the layout object is the key), and a build
 * mode edit is committed by packing the grid back into the save, which bumps `version` so
 * the view and the walked scene catch up.
 */

/** A claimed site in the loaded zone. */
export interface HideoutSite {
  hideoutId: string;
  site: SiteDef;
  frame: SiteFrame;
  build: BuildSite;
  /** The grid as saved. Edit a clone and `commit` it; this one is shared. */
  grid: BuildGrid;
  state: HideoutState;
}

export interface HideoutPrompt {
  text: string;
  act(): void;
}

export interface Hideouts {
  /** Bumped by every commit or zone change. */
  readonly version: number;
  /** The claimed hideouts in the loaded zone. */
  sites(): HideoutSite[];
  site(hideoutId: string): HideoutSite | undefined;
  /** The claimed hideout whose build bounds (give or take `marginM`) hold a zone point. */
  siteAt(at: { x: number; z: number }, marginM?: number): HideoutSite | undefined;
  /** Saves an edited grid as the hideout's layout. */
  commit(hideoutId: string, grid: BuildGrid): void;
  /** Built pieces as the on-foot controller's solids, zone meters. */
  colliders(): Collider[];
  /** F on foot at a storage piece or the strongbox: open that hideout's storage. */
  prompt(at: { x: number; y: number; z: number }): HideoutPrompt | undefined;
  /** For the dev hooks: the strongbox you'd open on foot, zone meters. */
  strongbox(): { x: number; y: number; z: number; hideout: string } | undefined;
  /** For the dev hooks: a bunk you'd sleep in, zone meters (Phase 8 piece F). */
  bunk(): { x: number; y: number; z: number; hideout: string } | undefined;
  /**
   * Every piece of every site, placed for the renderer. `cut` hides one site's levels above
   * the one edited, but for its roofs and gables when `roofs` (a roof's being placed).
   */
  draw(cut?: { hideoutId: string; level: number; roofs: boolean }): {
    key: string;
    frame: SiteFrame;
    pieces: PlacedRender[];
  }[];
  /** Something changed that the view and the walked scene should pick up. */
  onChange(listener: () => void): () => void;
  /** The zone changed (or a save loaded): forget the placed sites. */
  invalidate(): void;
}

export interface HideoutsDeps {
  state: WorldState;
  /** The loaded zone, or undefined off a zone (open water, an arena). */
  zone(): { id: string; frame: ZoneFrame } | undefined;
  /** The zone's ground height, meters above the lake (negative under it). */
  heightAt(x: number, z: number): number;
  openStash(hideoutId: string): boolean;
  /** F at a built bunk (Phase 8 piece F): the sleep choice. */
  sleep?(hideoutId: string): void;
  /**
   * Something in your arms to put in the stores (piece F's salvage): the prompt at a
   * storage piece stacks it there instead of opening the stash.
   */
  carrying?(): { text: string; stow(hideoutId: string): void } | undefined;
  notice(text: string): void;
}

/** Reach to a storage piece or the strongbox. */
const REACH_M = 2.2;
/** The stash is what F usually means: the bunk takes it only when this much nearer. */
const BUNK_HANDICAP_M = 0.8;

export function attachHideouts(deps: HideoutsDeps): Hideouts {
  const { state } = deps;
  let version = 0;
  const listeners = new Set<() => void>();
  const grids = new WeakMap<PackedLayout, BuildGrid>();
  let placed: { zoneId: string; frames: Map<string, SiteFrame> } | undefined;

  const framesFor = (zone: { id: string; frame: ZoneFrame }): Map<string, SiteFrame> => {
    if (placed?.zoneId === zone.id) return placed.frames;
    const frames = new Map<string, SiteFrame>();
    for (const s of SITES) {
      if (s.zone !== zone.id) continue;
      const fp = siteFootprint(s, zone.frame);
      if (fp) frames.set(s.id, siteFrame(s, fp));
    }
    placed = { zoneId: zone.id, frames };
    return frames;
  };

  const gridOf = (h: HideoutState): BuildGrid => {
    let g = grids.get(h.layout);
    if (!g) {
      g = unpackGrid(h.layout);
      grids.set(h.layout, g);
    }
    return g;
  };

  const sites = (): HideoutSite[] => {
    const zone = deps.zone();
    if (!zone) return [];
    const frames = framesFor(zone);
    const out: HideoutSite[] = [];
    for (const s of SITES) {
      const frame = frames.get(s.id);
      const h = state.hideouts?.[hideoutIdOf(s.id)];
      if (!frame || !h) continue;
      out.push({
        hideoutId: hideoutIdOf(s.id),
        site: s,
        frame,
        build: buildSiteOf(frame, deps.heightAt),
        grid: gridOf(h),
        state: h,
      });
    }
    return out;
  };

  const changed = (): void => {
    version++;
    for (const l of listeners) l();
  };

  type Point = { x: number; y: number; z: number; hideout: string; box: boolean; bed: boolean };
  /** Built storage pieces, strongboxes and bunks: middles in zone meters, floor heights. */
  const stashPoints = (): Point[] => {
    const out: Point[] = [];
    for (const s of sites()) {
      for (const r of placedRender(s.grid, s.build)) {
        if (!r.built) continue;
        const f = structure(r.id).functions;
        if (!f.strongbox && !f.storageCu && !f.bed) continue;
        const p = siteToZone(s.frame, r.x, r.z);
        out.push({
          ...p,
          y: s.frame.baseM + r.y,
          hideout: s.hideoutId,
          box: !!f.strongbox,
          bed: !!f.bed && !f.storageCu && !f.strongbox,
        });
      }
    }
    // The strongbox first, so it's the one named when both are in reach; bunks last.
    return out.sort((a, b) => Number(b.box) - Number(a.box) || Number(a.bed) - Number(b.bed));
  };

  return {
    get version() {
      return version;
    },
    sites,
    site: (id) => sites().find((s) => s.hideoutId === id),
    siteAt(at, marginM = 0) {
      for (const s of sites()) {
        const p = zoneToSite(s.frame, at.x, at.z);
        if (inSiteBounds(s.frame, p.x, p.z, marginM)) return s;
      }
      return undefined;
    },
    commit(hideoutId, grid) {
      const h = state.hideouts?.[hideoutId];
      if (!h) return;
      h.layout = packGrid(grid);
      changed();
    },
    colliders() {
      const out: Collider[] = [];
      for (const s of sites()) {
        for (const c of hideoutColliders(s.grid, s.build)) {
          if (c.kind === 'door') continue;
          const mid = siteToZone(s.frame, (c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2);
          const def = structure(s.grid.get(c.uid)?.piece.id ?? '');
          const stone = def.variants.some((v) => v.material === 'brownstone');
          out.push({
            kind: 'box',
            x: mid.x,
            z: mid.z,
            halfX: (c.maxX - c.minX) / 2,
            halfZ: (c.maxZ - c.minZ) / 2,
            yaw: s.frame.yaw,
            minY: s.frame.baseM + c.minY,
            maxY: s.frame.baseM + c.maxY,
            surface:
              c.kind === 'floor' && stone && def.category === 'foundation' ? 'stone' : 'wood',
            ...(c.kind === 'solid' && c.maxY - c.minY <= 1.2 ? { spot: 'vault' as const } : {}),
          });
        }
      }
      return out;
    },
    prompt(at) {
      const load = deps.carrying?.();
      const near = stashPoints().filter(
        (p) => Math.hypot(at.x - p.x, at.z - p.z) <= REACH_M && Math.abs(at.y - p.y) <= 1.6,
      );
      if (load) {
        const p = near.find((q) => !q.bed);
        return p && { text: load.text, act: () => load.stow(p.hideout) };
      }
      // A bunk when it's clearly the nearest thing in reach (by a step); else the strongbox,
      // then the stores.
      const reach = (p: Point): number =>
        Math.hypot(at.x - p.x, at.z - p.z) + (p.bed ? BUNK_HANDICAP_M : 0);
      const nearest = [...near].sort((a, b) => reach(a) - reach(b))[0];
      const sleep = deps.sleep;
      if (nearest?.bed && sleep) {
        return { text: 'Sleep in the bunk', act: () => sleep(nearest.hideout) };
      }
      const p = near.find((q) => !q.bed);
      if (!p) return undefined;
      return {
        text: p.box ? 'Open the stash' : 'Open the stores',
        act: () => {
          if (!deps.openStash(p.hideout)) deps.notice('Not now');
        },
      };
    },
    strongbox() {
      const b = stashPoints().find((p) => p.box);
      return b && { x: b.x, y: b.y, z: b.z, hideout: b.hideout };
    },
    bunk() {
      const b = stashPoints().find((p) => p.bed);
      return b && { x: b.x, y: b.y, z: b.z, hideout: b.hideout };
    },
    draw(cut) {
      return sites().map((s) => {
        let pieces = placedRender(s.grid, s.build);
        if (cut && cut.hideoutId === s.hideoutId) {
          // Levels above the one edited are cut away (plan 09 §9). A roof on level L + 1
          // stands on level L's walls, so it goes with the level above, unless it's roofs
          // being laid.
          pieces = pieces.filter((r) => {
            const p = s.grid.get(r.uid)?.piece;
            if (!p || p.level <= cut.level) return true;
            if (!cut.roofs || p.level > cut.level + 1) return false;
            const d = structure(p.id);
            return d.placement === 'roof' || !!d.onRoof;
          });
        }
        return { key: s.hideoutId, frame: s.frame, pieces };
      });
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    invalidate() {
      placed = undefined;
      changed();
    },
  };
}
