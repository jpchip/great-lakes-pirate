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
import { formatCents } from '../sim/economy/knowledge';
import { claimSite, hideoutIdOf, leaseSite, SITES, type HideoutState } from '../sim/hideouts/stash';
import { emptyLayout } from '../sim/hideouts/grid';
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
  /**
   * A site nobody holds whose bounds (give or take `marginM`) hold a zone point (Phase 9
   * piece W): build mode opens on it, and the first thing built claims it.
   */
  openSiteAt(at: { x: number; z: number }, marginM?: number): HideoutSite | undefined;
  /**
   * The zone's sites on the mainland with no island of their own (piece W), held or not:
   * where a landing walks the zone's ground round them, at the bounds' middle.
   */
  mainlandPads(): { id: string; x: number; z: number }[];
  /**
   * Saves an edited grid as the hideout's layout. A site not yet held is claimed by it,
   * once there's anything on the grid.
   */
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
   * Built stills with a batch loaded, zone meters at the pot (Phase 8 piece I: the still
   * heard at work). Cheap to call each frame: the places are worked out once per change.
   */
  runningStills(): { x: number; y: number; z: number }[];
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
  openStash(hideoutId: string, tab?: 'slipway'): boolean;
  /** F at a built bunk (Phase 8 piece F): the sleep choice. */
  sleep?(hideoutId: string): void;
  /**
   * Something in your arms to put in the stores (piece F's salvage): the prompt at a
   * storage piece stacks it there instead of opening the stash.
   */
  carrying?(): { text: string; stow(hideoutId: string): void } | undefined;
  notice(text: string): void;
  /** A site claimed by building on it, or by its lease (Phase 9 piece W). */
  claimed?(site: SiteDef, hideoutId: string, how: 'built' | 'leased' | 'squatted'): void;
}

/** How near an owned site's bounds its lease is offered, m. */
const LEASE_MARGIN_M = 6;

/** Reach to a storage piece or the strongbox. */
const REACH_M = 2.2;
/** Reach to the head of the ways: anywhere on its dry cell. */
const WAYS_REACH_M = 2.5;
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

  /** The zone's sites nobody holds, each with an empty claim it would make. */
  const openSites = (): HideoutSite[] => {
    const zone = deps.zone();
    if (!zone) return [];
    const frames = framesFor(zone);
    const out: HideoutSite[] = [];
    for (const s of SITES) {
      const frame = frames.get(s.id);
      if (!frame || state.hideouts?.[hideoutIdOf(s.id)]) continue;
      const h: HideoutState = {
        siteId: s.id,
        claimedAt: state.environment.clock.gameSeconds,
        storage: { goods: [], cash: 0 },
        layout: emptyLayout(),
      };
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

  const within = (s: HideoutSite, at: { x: number; z: number }, marginM: number): boolean => {
    const p = zoneToSite(s.frame, at.x, at.z);
    return inSiteBounds(s.frame, p.x, p.z, marginM);
  };

  const changed = (): void => {
    version++;
    for (const l of listeners) l();
  };

  type Point = {
    x: number;
    y: number;
    z: number;
    hideout: string;
    box: boolean;
    bed: boolean;
    ways?: boolean;
  };
  /** Built storage pieces, strongboxes and bunks, and the head of each ways: zone meters. */
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
      // The head of the ways (piece G): the slipway's work is done from its dry end.
      const head = slipwayHead(s.grid, s.build);
      if (head) {
        const p = siteToZone(s.frame, head.x, head.z);
        const y = Math.max(0, deps.heightAt(p.x, p.z));
        out.push({ ...p, y, hideout: s.hideoutId, box: false, bed: false, ways: true });
      }
    }
    // The strongbox first, so it's the one named when both are in reach; bunks last.
    return out.sort((a, b) => Number(b.box) - Number(a.box) || Number(a.bed) - Number(b.bed));
  };

  const STILL_PIECE = 'build.distillery';
  const STILL_STATION = 'station.distillery';
  let stillCache:
    { key: string; at: { x: number; y: number; z: number; hideout: string }[] } | undefined;
  const stillPlaces = (): { x: number; y: number; z: number; hideout: string }[] => {
    const key = `${version}:${deps.zone()?.id ?? ''}:${Object.keys(state.hideouts ?? {}).length}`;
    if (stillCache?.key === key) return stillCache.at;
    const at: { x: number; y: number; z: number; hideout: string }[] = [];
    for (const s of sites()) {
      for (const r of placedRender(s.grid, s.build)) {
        if (!r.built || r.id !== STILL_PIECE) continue;
        const p = siteToZone(s.frame, r.x, r.z);
        at.push({ ...p, y: s.frame.baseM + r.y + 1, hideout: s.hideoutId });
      }
    }
    stillCache = { key, at };
    return at;
  };

  /** An owned site's lease, offered on its ground while it isn't yours by one (piece W). */
  const leasePrompt = (at: { x: number; z: number }): HideoutPrompt | undefined => {
    const s = [...sites(), ...openSites()].find(
      (x) => x.site.lease && x.state.tenure !== 'leased' && within(x, at, LEASE_MARGIN_M),
    );
    const lease = s?.site.lease;
    if (!s || !lease) return undefined;
    return {
      text: `Lease the ground from ${lease.from} (${formatCents(lease.cents, true)})`,
      act: () => {
        const had = !!state.hideouts?.[s.hideoutId];
        const r = leaseSite(
          (state.hideouts ??= {}),
          s.site,
          state.player,
          state.environment.clock.gameSeconds,
        );
        if (!r.ok) {
          deps.notice(r.reason);
          return;
        }
        changed();
        deps.notice(
          had
            ? `The lease is yours: ${s.site.shortName} is held fair and square.`
            : `The lease is yours: ${s.site.shortName} is your ground to build on.`,
        );
        deps.claimed?.(s.site, s.hideoutId, 'leased');
      },
    };
  };

  return {
    get version() {
      return version;
    },
    runningStills() {
      const places = stillPlaces();
      if (places.length === 0) return [];
      const now = state.environment.clock.gameSeconds;
      return places
        .filter((p) =>
          (state.hideouts?.[p.hideout]?.stations?.[STILL_STATION]?.queue ?? []).some(
            (b) => b.readyAt > now,
          ),
        )
        .map(({ x, y, z }) => ({ x, y, z }));
    },
    sites,
    site: (id) => sites().find((s) => s.hideoutId === id),
    siteAt(at, marginM = 0) {
      return sites().find((s) => within(s, at, marginM));
    },
    mainlandPads() {
      const zone = deps.zone();
      if (!zone) return [];
      const out: { id: string; x: number; z: number }[] = [];
      for (const [id, f] of framesFor(zone)) {
        if (SITES.find((x) => x.id === id)?.island) continue;
        out.push({ id, ...siteToZone(f, f.cols, f.rows) });
      }
      return out;
    },
    openSiteAt(at, marginM = 0) {
      return openSites().find((s) => within(s, at, marginM));
    },
    commit(hideoutId, grid) {
      let h = state.hideouts?.[hideoutId];
      if (!h) {
        // The first thing built on a site nobody holds claims it (plan 09 §2.2).
        const site = SITES.find((x) => hideoutIdOf(x.id) === hideoutId);
        if (!site || grid.all().length === 0) return;
        h = claimSite((state.hideouts ??= {}), site, state.environment.clock.gameSeconds).state;
        h.layout = packGrid(grid);
        changed();
        deps.claimed?.(site, hideoutId, h.tenure === 'squatted' ? 'squatted' : 'built');
        return;
      }
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
      // The head of the ways: the slipway's work, from its dry end (Phase 8 piece G).
      for (const p of stashPoints()) {
        if (!p.ways) continue;
        if (Math.hypot(at.x - p.x, at.z - p.z) > WAYS_REACH_M) continue;
        if (Math.abs(at.y - p.y) > 2) continue;
        return {
          text: 'Work at the slipway',
          act: () => {
            if (!deps.openStash(p.hideout, 'slipway')) deps.notice('Not now');
          },
        };
      }
      const load = deps.carrying?.();
      const near = stashPoints().filter(
        (p) =>
          !p.ways && Math.hypot(at.x - p.x, at.z - p.z) <= REACH_M && Math.abs(at.y - p.y) <= 1.6,
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
      if (!p) return leasePrompt(at);
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
