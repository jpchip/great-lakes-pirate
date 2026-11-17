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
import { slipwayHead } from '../sim/hideouts/slipway';
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
  /** Opens the hideout's screen; `tab` 'slipway' at the ways (Phase 8 piece G). */
  openStash(hideoutId: string, tab?: 'slipway'): boolean;
  notice(text: string): void;
}

/** Reach to a storage piece or the strongbox. */
const REACH_M = 2.2;
/** Reach to the head of the ways: anywhere on its dry cell. */
const WAYS_REACH_M = 2.5;

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

  /** A built piece's middle in zone meters, with its floor height. */
  const stashPoints = (): {
    x: number;
    y: number;
    z: number;
    hideout: string;
    box: boolean;
    ways?: boolean;
  }[] => {
    const out: {
      x: number;
      y: number;
      z: number;
      hideout: string;
      box: boolean;
      ways?: boolean;
    }[] = [];
    for (const s of sites()) {
      for (const r of placedRender(s.grid, s.build)) {
        if (!r.built) continue;
        const f = structure(r.id).functions;
        if (!f.strongbox && !f.storageCu) continue;
        const p = siteToZone(s.frame, r.x, r.z);
        out.push({ ...p, y: s.frame.baseM + r.y, hideout: s.hideoutId, box: !!f.strongbox });
      }
      // The head of the ways (piece G): the slipway's work is done from its dry end.
      const head = slipwayHead(s.grid, s.build);
      if (head) {
        const p = siteToZone(s.frame, head.x, head.z);
        const y = Math.max(0, deps.heightAt(p.x, p.z));
        out.push({ ...p, y, hideout: s.hideoutId, box: false, ways: true });
      }
    }
    // The strongbox first, so it's the one named when both are in reach.
    return out.sort((a, b) => Number(b.box) - Number(a.box));
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
      for (const p of stashPoints()) {
        if (p.ways) {
          if (Math.hypot(at.x - p.x, at.z - p.z) > WAYS_REACH_M) continue;
          if (Math.abs(at.y - p.y) > 2) continue;
          return {
            text: 'Work at the slipway',
            act: () => {
              if (!deps.openStash(p.hideout, 'slipway')) deps.notice('Not now');
            },
          };
        }
        if (Math.hypot(at.x - p.x, at.z - p.z) > REACH_M) continue;
        if (Math.abs(at.y - p.y) > 1.6) continue;
        return {
          text: p.box ? 'Open the stash' : 'Open the stores',
          act: () => {
            if (!deps.openStash(p.hideout)) deps.notice('Not now');
          },
        };
      }
      return undefined;
    },
    strongbox() {
      const b = stashPoints().find((p) => p.box);
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
