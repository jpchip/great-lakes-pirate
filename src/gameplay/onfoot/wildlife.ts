import type { SpeciesDef, WildlifeFile } from '../../../data/schemas/wildlife';
import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { PlacedIsland } from '../../sim/islands/on-foot';
import {
  createAnimal,
  hearShot,
  isDead,
  moveAnimal,
  shootAnimal,
  thinkAnimal,
  type Animal,
  type AnimalEvent,
  type Perception,
} from '../../sim/wildlife/animals';
import { WILDLIFE, speciesOf } from '../../sim/wildlife/defs';
import {
  deerLeft,
  hitChance,
  monthAt,
  visitors,
  type Visitors,
  type WildlifeState,
} from '../../sim/wildlife/hunt';
import { gameGround, lieUp, readSign, signTrail, type Sign } from '../../sim/wildlife/spawn';
import { checkTrap, trapSeason, trapSpots, type TrapSpot } from '../../sim/wildlife/traps';
import type { AshoreScene } from './ashore-scene';
import { footprintDistance, type Collider, type Push } from './colliders';
import type { CharacterState, ControllerParams } from './controller';
import { lineBlocked } from './sightline';

/**
 * Hunting and wildlife on an island (plan 11 §3.2, §4; §18.4 piece V): the deer, a bear or
 * a winter wolf pack about on a landing, moving over the island's own ground; the sign that
 * leads to the deer; the rifle (the ship's own, from its hand mount) shot at whatever is in
 * your sights; field-dressing a deer where it fell and carrying the carcass, slowly, to the
 * boat, where it goes into the hold as venison; and the traplines round the trappers'
 * cabins, set in the open season and checked weeks later.
 *
 * Bears and wolves warn before they attack (a line on the HUD until piece Y's growls), are
 * turned by a shot, a fire, or your backing off, and can kill you (`mauled`). Killing an
 * animal is no crime, but a shot is heard a long way: the island's people come to look.
 */

export interface WildlifePrompt {
  text: string;
  act(): void;
}

export interface WildlifeHooks {
  notice(text: string): void;
  /**
   * An animal's call or move that you can hear (piece Y): it warns (`wary`, `threaten`,
   * `attack`, `flee`), or a deer bolts. Placed where the animal is, zone meters.
   */
  cue?(cue: {
    species: string;
    state: 'wary' | 'threaten' | 'attack' | 'flee' | 'bolt';
    at: { x: number; z: number };
  }): void;
  /** Bitten or mauled: health off. */
  hurt(amount: number): void;
  /** A shot fired from where you stand (heard by the island's people, and heard). */
  shot(at: { x: number; y: number; z: number }, hit: boolean, killed: boolean): void;
  /** An animal killed (`AnimalKilled`). */
  killed(species: string, island: string): void;
  /** A trap set or emptied (`TrapPlaced`, `TrapCollected`). */
  trap(act: 'placed' | 'collected', spot: string, pelts: number): void;
  /** The carcass laid in the boat: the refusal if the hold's full. */
  stow(good: string, qty: number): string | undefined;
  /** Pelts into the hold: the refusal if it's full. */
  furs(good: string, qty: number): string | undefined;
}

export interface WildlifeOptions {
  island: PlacedIsland;
  scene: AshoreScene;
  /** Where you came ashore: the animals lie up away from it, and the sign starts near it. */
  landing: { x: number; z: number };
  /** The tier's animal budget (`island_tiers.json` `animals`). */
  budget: number;
  now(): number;
  runSeed(): number;
  /** The save's `wildlife`, made if absent. */
  state(): WildlifeState;
  /** The ship's lockers (the traps), and whether the ship carries the rifle. */
  stores: Record<string, number>;
  hasRifle(): boolean;
  /** The Poacher's woodcraft. */
  woodcraft(): boolean;
  /** How lit it is, 0 (moonless night) to 1 (day), and fog visibility, m. */
  light01(): number;
  fogM(): number;
  /** The way the air moves here, zone meters per second (x east, z south). */
  wind(): { x: number; z: number };
  /** Fires burning ashore here, zone meters: the island's stoves and camp fires. */
  fires?: { x: number; z: number }[];
  hooks: WildlifeHooks;
  file?: WildlifeFile;
}

/** What the view draws (zone meters). */
export interface WildlifeFrame {
  animals: {
    id: string;
    species: string;
    state: string;
    x: number;
    y: number;
    z: number;
    heading: number;
    moving: number;
  }[];
  sign: { x: number; y: number; z: number; heading: number }[];
  traps: { x: number; y: number; z: number; set: boolean }[];
  /** You have a carcass over your shoulders. */
  carrying: boolean;
}

export interface IslandWildlife {
  /** The island they're on. */
  readonly island: string;
  readonly animals: readonly Animal[];
  readonly sign: readonly Sign[];
  readonly spots: readonly TrapSpot[];
  /** A carcass over your shoulders: what it'll make in the hold. */
  readonly carrying: { good: string; cu: number } | undefined;
  /** Each frame: the animals look, listen, sniff, think and move; F held to dress. */
  step(
    dt: number,
    player: CharacterState,
    inputs: { strideM: number; interactDown: boolean; beyond: boolean },
  ): void;
  /** What F does now, if anything here wants it. */
  prompt(player: CharacterState): WildlifePrompt | undefined;
  /** At the boat with a carcass: lay it in. */
  boatPrompt(): WildlifePrompt | undefined;
  /**
   * At a hideout's strongbox or stores with a carcass: lay it in with `stow` (the refusal
   * if there's no room), as venison, the same as in the boat.
   */
  stashCarcass(
    stow: (good: string, cu: number) => string | undefined,
    /** Where it went, for the notice. */
    where?: string,
  ): void;
  /** Slower under a carcass. */
  params(base: ControllerParams): ControllerParams;
  frame(): WildlifeFrame;
  /** For the dev hooks: one more animal, here. */
  spawn(species: string, at: { x: number; z: number }): Animal | undefined;
  /** For the dev hooks: fire at an animal from where you stand (the odds as they are). */
  shoot(player: CharacterState, id?: string): string;
}

/** Animals look this often, per second (each staggered). */
const LOOK_HZ = 5;
/** A stride's sound lingers this long for an animal's ears, s. */
const HEAR_HOLD_S = 0.6;
/** Within this of a downed deer, you can dress it or lift the carcass. */
const DRESS_REACH_M = 2.2;
/** A rifle ball's time to reload, s (weapons.json's rifle). */
const RELOAD_S = 2.5;
/** Within this of a fire you're safe from them (a share of its keep-off). */
const FIRE_SAFE = 0.7;
/** The animal's eye, and your chest, m off the ground. */
const EYE_M = 0.9;
const CHEST_M = 1.3;
/** An animal's body for walls: it squeezes past what a man does. */
const BODY_R = 0.35;

/** The sign kept about at once (the view draws this many). */
const MAX_SIGN = 24;

const nounOf = (s: SpeciesDef): string => `the ${s.noun}`;

export function createIslandWildlife(opts: WildlifeOptions): IslandWildlife {
  const file = opts.file ?? WILDLIFE;
  const { island, scene } = opts;
  const heightAt = (x: number, z: number): number => scene.ground.heightAt(x, z);
  const t0 = opts.now();
  const day = dayAndHour(t0).day;
  const month = monthAt(t0);
  const rng = Rng.fromSeed(`${opts.runSeed()}:wildlife:${island.id}:${day}:${Math.round(t0)}`);
  const fires = opts.fires ?? island.marks.filter((m) => m.kind === 'fire');
  const animals: Animal[] = [];
  let sign: Sign[] = [];

  // --- Who's about --------------------------------------------------------------------
  const pop = file.population;
  let nextId = 0;
  // Each sign trail's herd, by the animals in it: reading the sign tells of that herd.
  const herdOf = new Map<Sign, readonly string[]>();
  const place = (
    species: SpeciesDef,
    n: number,
    from: { x: number; z: number },
    minFrom: number,
    maxFrom: number,
  ): { at: { x: number; z: number }; ids: string[] } | undefined => {
    if (n <= 0) return undefined;
    const at = lieUp(island, heightAt, from, rng, {
      minFromM: minFrom,
      maxFromM: maxFrom,
      clearOfM: pop.keepClearOfHomesM,
    });
    if (!at) return undefined;
    const ids: string[] = [];
    for (let k = 0; k < n; k++) {
      for (let tries = 0; tries < 12; tries++) {
        const a = rng.range(0, Math.PI * 2);
        const r = k === 0 ? 0 : rng.range(3, pop.herdSpreadM);
        const x = at.x + Math.sin(a) * r;
        const z = at.z - Math.cos(a) * r;
        if (!gameGround(island, heightAt, x, z)) continue;
        const id = `${species.id.replace('animal.', '')}.${nextId++}`;
        animals.push(createAnimal(id, species, { x, y: heightAt(x, z), z }, rng.range(0, 6.28)));
        ids.push(id);
        break;
      }
    }
    return { at, ids };
  };
  /** Puts game about round `from`: the deer groups (each with its trail of sign), a bear, the wolves. */
  const putAbout = (
    who: Visitors,
    from: { x: number; z: number },
    deerFrom: [number, number],
    predatorFrom: [number, number],
  ): Sign[] => {
    const trails: Sign[] = [];
    for (const n of who.herds) {
      const herd = place(speciesOf('animal.deer', file), n, from, deerFrom[0], deerFrom[1]);
      if (!herd) continue;
      for (const k of signTrail(island, heightAt, from, herd.at, rng, file)) {
        herdOf.set(k, herd.ids);
        trails.push(k);
      }
    }
    const [lo, hi] = predatorFrom;
    if (who.bear) place(speciesOf('animal.bear', file), 1, from, lo, hi);
    if (who.wolves) place(speciesOf('animal.wolf', file), who.wolves, from, lo + 20, hi + 40);
    return trails;
  };
  sign = putAbout(
    visitors(
      island.id,
      {
        deerLeft: deerLeft(island.id, opts.state(), opts.runSeed(), t0, file),
        month,
        day,
        runSeed: opts.runSeed(),
        budget: opts.budget,
      },
      file,
    ),
    opts.landing,
    [pop.herdMinFromLandingM, 480],
    [160, 520],
  );
  const spots = trapSpots(island, heightAt, file);

  // --- Further on -----------------------------------------------------------------------
  // Game isn't only round the landing: each time you've walked `roam.everyM` from where game
  // was last put about, what you've left well behind (and not stirred up) goes, and the next
  // stretch of the island gets its own, out of the same herd and the same tier budget.
  const roam = pop.roam;
  let lastAbout = { x: opts.landing.x, z: opts.landing.z };
  const settled = (a: Animal): boolean =>
    a.state === 'graze' || a.state === 'wander' || a.state === 'alert' || a.state === 'wary';
  const roamTo = (at: { x: number; z: number }): void => {
    lastAbout = { x: at.x, z: at.z };
    for (let k = animals.length - 1; k >= 0; k--) {
      const a = animals[k] as Animal;
      const far = Math.hypot(a.x - at.x, a.z - at.z) > roam.dropM;
      if (far && (settled(a) || a.taken)) {
        animals.splice(k, 1);
        lastSeen.delete(a.id);
      }
    }
    const kept = sign.filter((k) => Math.hypot(k.x - at.x, k.z - at.z) < roam.dropM);
    for (const k of sign) if (!kept.includes(k)) herdOf.delete(k);
    const live = animals.filter((a) => !isDead(a) && !a.taken);
    const liveDeer = live.filter((a) => a.species.kind === 'deer').length;
    const now = opts.now();
    const who = visitors(
      island.id,
      {
        deerLeft: deerLeft(island.id, opts.state(), opts.runSeed(), now, file) - liveDeer,
        month: monthAt(now),
        day: dayAndHour(now).day,
        runSeed: opts.runSeed(),
        budget: opts.budget - live.length,
        herds: 1,
        key: `${Math.round(at.x / roam.everyM)},${Math.round(at.z / roam.everyM)}`,
      },
      file,
    );
    // Only one bear on a stretch at a time.
    if (live.some((a) => a.species.id === 'animal.bear')) who.bear = false;
    if (live.some((a) => a.species.id === 'animal.wolf')) who.wolves = 0;
    const fresh = putAbout(
      who,
      at,
      [roam.minFromM, roam.maxFromM],
      [roam.minFromM + 20, roam.maxFromM + 60],
    );
    sign = [...kept, ...fresh].slice(-MAX_SIGN);
  };

  // --- Senses -------------------------------------------------------------------------
  let heardM = 0;
  let heardFor = 0;
  let lookIn = 0;
  const lastSeen = new Map<string, Perception>();
  const near: Collider[] = [];
  const push: Push = { nx: 0, nz: 0 };

  const nearFire = (x: number, z: number, m: number): boolean =>
    fires.some((f) => Math.hypot(f.x - x, f.z - z) < m);

  const walkable = (a: Animal) => (x: number, z: number) => {
    if (!gameGround(island, heightAt, x, z)) return false;
    // It won't come within its keep-off of a fire, though it may walk out of it.
    const keep = a.species.fire.keepOffM;
    if (nearFire(x, z, keep) && !nearFire(a.x, a.z, keep)) return false;
    scene.colliders.query(x, z, BODY_R, near);
    const y = heightAt(x, z);
    for (const c of near) {
      if (c.maxY < y + 0.3 || c.minY > y + 1.2) continue;
      if (footprintDistance(c, x, z, push) < BODY_R) return false;
    }
    return true;
  };

  const perceive = (a: Animal, p: CharacterState, beyond: boolean): Perception => {
    const s = a.species;
    const at = { x: p.position.x, z: p.position.z };
    const d = Math.hypot(at.x - a.x, at.z - a.z);
    const moving = Math.hypot(p.velocity.x, p.velocity.z);
    const stance = p.crouching ? 0.5 : 1;
    const motion = moving < 0.3 ? 0.5 : moving > 4 ? 1.3 : 1;
    const light = 0.45 + 0.55 * Math.min(1, Math.max(0, opts.light01()));
    const sightM = Math.min(s.senses.sightM * light * stance * motion, opts.fogM());
    let sees = false;
    if (!beyond && d < sightM) {
      sees = !lineBlocked(
        scene.colliders,
        { x: a.x, y: a.y + EYE_M, z: a.z },
        { x: at.x, y: p.position.y + CHEST_M * stance, z: at.z },
        scene.ground,
        2,
      );
    }
    const hears = !beyond && heardFor > 0 && d < heardM * s.senses.hearing;
    // Your scent goes where the air goes: downwind of you it smells you a long way; in a
    // calm, only close.
    const w = opts.wind();
    const ws = Math.hypot(w.x, w.z);
    let smells = false;
    if (!beyond && d > 0.1) {
      if (ws < 0.6) {
        smells = d < s.senses.smellM * 0.25;
      } else {
        const along = ((a.x - at.x) * w.x + (a.z - at.z) * w.z) / (d * ws);
        smells = along > 0.7 && d < s.senses.smellM;
      }
    }
    const byFire = nearFire(at.x, at.z, s.fire.keepOffM * FIRE_SAFE);
    return { at, distM: d, sees, hears, smells, byFire, beyond };
  };

  // --- Events -------------------------------------------------------------------------
  const told = new Map<string, string>();
  const handle = (events: AnimalEvent[]): void => {
    for (const e of events) {
      const a = animals.find((k) => k.id === e.animal);
      if (!a) continue;
      switch (e.type) {
        case 'Warned': {
          opts.hooks.cue?.({ species: a.species.id, state: e.state, at: { x: a.x, z: a.z } });
          // One line per animal kind and state at a time: a pack doesn't say it three times.
          const key = `${a.species.id}:${e.state}`;
          const line = a.species.warn?.[e.state];
          if (line && told.get(a.species.id) !== key) {
            told.set(a.species.id, key);
            opts.hooks.notice(line);
          }
          break;
        }
        case 'Bit':
          opts.hooks.hurt(e.damage);
          break;
        case 'Died':
          opts.hooks.killed(a.species.id, island.id);
          if (a.species.kind === 'deer') {
            const st = opts.state();
            (st.taken[island.id] ??= []).push(opts.now());
          }
          break;
        case 'Bolted':
          opts.hooks.cue?.({ species: a.species.id, state: 'bolt', at: { x: a.x, z: a.z } });
          break;
      }
    }
  };

  // --- The hunt -----------------------------------------------------------------------
  let reloadIn = 0;
  let carrying: { good: string; cu: number } | undefined;
  let dressing: { id: string; held: number } | undefined;

  const inSights = (p: CharacterState): Animal | undefined => {
    const h = file.hunt;
    const cone = (h.coneDeg * Math.PI) / 180;
    let best: Animal | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const a of animals) {
      if (isDead(a) || a.taken) continue;
      const d = Math.hypot(a.x - p.position.x, a.z - p.position.z);
      if (d > h.rangeM || d < 0.5) continue;
      const bearing = Math.atan2(a.x - p.position.x, -(a.z - p.position.z));
      const off = Math.abs(
        Math.atan2(Math.sin(bearing - p.heading), Math.cos(bearing - p.heading)),
      );
      // A close animal is a big target: the cone widens for it.
      if (off > cone + Math.atan2(a.species.lengthM / 2, d)) continue;
      const blocked = lineBlocked(
        scene.colliders,
        { x: p.position.x, y: p.position.y + 1.5, z: p.position.z },
        { x: a.x, y: a.y + a.species.heightM * 0.7, z: a.z },
        scene.ground,
        2,
      );
      if (blocked) continue;
      const score = off * 50 + d;
      if (score < bestScore) {
        bestScore = score;
        best = a;
      }
    }
    return best;
  };

  const fire = (p: CharacterState, target: Animal | undefined): string => {
    if (!opts.hasRifle()) return 'No rifle aboard';
    if (reloadIn > 0) return 'Reloading';
    reloadIn = RELOAD_S;
    const from = { x: p.position.x, z: p.position.z };
    const events: AnimalEvent[] = [];
    let hit = false;
    let killed = false;
    if (target) {
      const d = Math.hypot(target.x - from.x, target.z - from.z);
      const pHit = hitChance(
        d,
        {
          crouched: p.crouching,
          moving: Math.hypot(p.velocity.x, p.velocity.z) > 0.5,
          targetRunning: target.speed > target.species.walkMps * 1.5,
        },
        file,
      );
      hit = rng.chance(pHit);
      if (hit) {
        killed = shootAnimal(target, from, rng, events, {
          killChance: file.hunt.killChance,
          woundedS: file.hunt.woundedS,
        });
      }
    }
    // Every animal within earshot hears it: deer run, a bear or the wolves may.
    for (const a of animals) {
      if (a === target && hit) continue;
      if (Math.hypot(a.x - from.x, a.z - from.z) > file.hunt.noiseM) continue;
      hearShot(a, from, rng, events);
    }
    opts.hooks.shot({ x: from.x, y: p.position.y, z: from.z }, hit, killed);
    handle(events);
    if (!target) return 'You fire at nothing';
    const noun = nounOf(target.species);
    if (!hit) return `Missed ${noun}`;
    if (killed) return `You dropped ${noun}`;
    if (target.state === 'wounded') return `Hit: ${noun} runs on, wounded`;
    return `Hit ${noun}`;
  };

  const downedNear = (p: CharacterState): Animal | undefined =>
    animals.find(
      (a) =>
        isDead(a) &&
        !a.taken &&
        a.species.kind === 'deer' &&
        Math.hypot(a.x - p.position.x, a.z - p.position.z) < DRESS_REACH_M,
    );

  const dressS = (): number => (opts.woodcraft() ? file.hunt.woodcraftDressS : file.hunt.dressS);

  const trapNear = (p: CharacterState): TrapSpot | undefined =>
    spots.find((s) => Math.hypot(s.x - p.position.x, s.z - p.position.z) < file.traps.reachM);

  const trapPrompt = (s: TrapSpot): WildlifePrompt => {
    const st = opts.state();
    const set = st.traps[s.id];
    const now = opts.now();
    if (set) {
      const c = checkTrap(s.id, set.setAt, now, opts.runSeed(), opts.woodcraft(), file);
      if (!c.ready) {
        return {
          text: 'Your trap: nothing yet',
          act: () => opts.hooks.notice('The trap is set and untouched. Give it a week or two.'),
        };
      }
      return {
        text: c.caught && !c.spoiled ? 'Take the pelt from the trap' : 'Check the trap',
        act: () => collect(s),
      };
    }
    const n = opts.stores[file.traps.store] ?? 0;
    if (!trapSeason(monthAt(now), file)) {
      return {
        text: 'A trap spot (out of season)',
        act: () =>
          opts.hooks.notice('A good spot for a trap, but the season is closed until November.'),
      };
    }
    if (n <= 0) {
      return {
        text: 'A trap spot (no traps aboard)',
        act: () => opts.hooks.notice('A good spot for a trap. Buy steel traps at a chandlery.'),
      };
    }
    return {
      text: `Set a trap (${n} aboard)`,
      act: () => {
        st.traps[s.id] = { setAt: opts.now() };
        opts.stores[file.traps.store] = n - 1;
        opts.hooks.trap('placed', s.id, 0);
        opts.hooks.notice('You set the trap and brush snow over the jaws.');
      },
    };
  };

  const collect = (s: TrapSpot): void => {
    const st = opts.state();
    const set = st.traps[s.id];
    if (!set) return;
    const c = checkTrap(s.id, set.setAt, opts.now(), opts.runSeed(), opts.woodcraft(), file);
    if (c.caught && !c.spoiled) {
      const refused = opts.hooks.furs(file.traps.good, 1);
      if (refused) {
        opts.hooks.notice(refused);
        return;
      }
      opts.hooks.notice('A good pelt. You take it, and the trap, back to the boat with you.');
    } else if (c.spoiled) {
      opts.hooks.notice("Something was caught here weeks ago. The pelt's ruined.");
    } else {
      opts.hooks.notice('Sprung and empty. You take the trap up.');
    }
    Reflect.deleteProperty(st.traps, s.id);
    opts.stores[file.traps.store] = (opts.stores[file.traps.store] ?? 0) + 1;
    opts.hooks.trap('collected', s.id, c.caught && !c.spoiled ? 1 : 0);
  };

  const signNear = (p: CharacterState): Sign | undefined =>
    sign.find((s) => Math.hypot(s.x - p.position.x, s.z - p.position.z) < file.sign.readM);

  /** The herd a trail of sign leads to, as it is now. */
  const herdNow = (k: Sign): { x: number; z: number; count: number } | undefined => {
    const ids = herdOf.get(k) ?? [];
    const live = animals.filter((a) => ids.includes(a.id) && !isDead(a) && !a.taken);
    if (!live.length) return undefined;
    const x = live.reduce((s, a) => s + a.x, 0) / live.length;
    const z = live.reduce((s, a) => s + a.z, 0) / live.length;
    return { x, z, count: live.length };
  };

  return {
    island: island.id,
    animals,
    get sign() {
      return sign;
    },
    spots,
    get carrying() {
      return carrying;
    },
    step(dt, player, inputs) {
      reloadIn = Math.max(0, reloadIn - dt);
      const here = player.position;
      if (!inputs.beyond && Math.hypot(here.x - lastAbout.x, here.z - lastAbout.z) > roam.everyM) {
        roamTo({ x: here.x, z: here.z });
      }
      if (inputs.strideM > 0) {
        heardM = inputs.strideM;
        heardFor = HEAR_HOLD_S;
      } else {
        heardFor = Math.max(0, heardFor - dt);
      }
      // Dressing goes on while F is held beside the deer.
      if (dressing) {
        const a = animals.find((k) => k.id === dressing?.id);
        if (!inputs.interactDown || !a || !downedNear(player)) {
          dressing = undefined;
        } else if ((dressing.held += dt) >= dressS()) {
          a.dressed = true;
          dressing = undefined;
          opts.hooks.notice(
            'Dressed out. Lift the carcass onto your shoulders and make for the boat.',
          );
        }
      }
      lookIn -= dt;
      const look = lookIn <= 0;
      if (look) lookIn = 1 / LOOK_HZ;
      const events: AnimalEvent[] = [];
      for (const a of animals) {
        if (isDead(a)) continue;
        let p = lastSeen.get(a.id);
        if (look || !p) {
          p = perceive(a, player, inputs.beyond);
          lastSeen.set(a.id, p);
        } else {
          // Between looks, distance and bearing follow you; the senses keep their last read.
          p = {
            ...p,
            at: { x: player.position.x, z: player.position.z },
            distM: Math.hypot(player.position.x - a.x, player.position.z - a.z),
            beyond: inputs.beyond,
          };
        }
        thinkAnimal(a, dt, p, rng, events, file.population.herdSpreadM);
        moveAnimal(a, dt, walkable(a), heightAt);
      }
      handle(events);
    },
    prompt(player) {
      if (!player.grounded || player.swimming) return undefined;
      if (carrying) {
        return {
          text: 'Put the carcass down',
          act: () => {
            const p = player.position;
            const a = createAnimal(
              `deer.${nextId++}`,
              speciesOf('animal.deer', file),
              { x: p.x, y: heightAt(p.x, p.z), z: p.z },
              player.heading,
            );
            a.state = 'dead';
            a.dressed = true;
            animals.push(a);
            carrying = undefined;
          },
        };
      }
      const down = downedNear(player);
      if (down) {
        if (dressing) {
          const pct = Math.round((dressing.held / dressS()) * 100);
          return { text: `Dressing the deer… ${pct}%`, act: () => undefined };
        }
        if (!down.dressed) {
          return {
            text: 'Field-dress the deer (hold F)',
            act: () => {
              dressing = { id: down.id, held: 0 };
            },
          };
        }
        return {
          text: 'Lift the carcass onto your shoulders',
          act: () => {
            down.taken = true;
            carrying = { good: file.hunt.carcass.good, cu: file.hunt.carcass.cu };
          },
        };
      }
      const trap = trapNear(player);
      if (trap) return trapPrompt(trap);
      const s = signNear(player);
      if (s) {
        return {
          text: 'Read the sign',
          act: () => opts.hooks.notice(readSign(s, herdNow(s), opts.woodcraft())),
        };
      }
      const target = inSights(player);
      if (target) {
        const d = Math.round(
          Math.hypot(target.x - player.position.x, target.z - player.position.z),
        );
        const noun = nounOf(target.species);
        if (!opts.hasRifle()) {
          return {
            text: `${target.species.name}, ${d} m (no rifle aboard)`,
            act: () => opts.hooks.notice('The rifle stays in its rack aboard a ship that has one.'),
          };
        }
        if (reloadIn > 0) return { text: 'Reloading…', act: () => undefined };
        return {
          text: `Shoot ${noun} (${d} m)`,
          act: () => opts.hooks.notice(fire(player, target)),
        };
      }
      return undefined;
    },
    boatPrompt() {
      if (!carrying) return undefined;
      const load = carrying;
      return {
        text: 'Lay the carcass in the boat',
        act: () => {
          const refused = opts.hooks.stow(load.good, load.cu);
          if (refused) {
            opts.hooks.notice(refused);
            return;
          }
          carrying = undefined;
          opts.hooks.notice(`The carcass goes into the hold: ${load.cu} CU of venison.`);
        },
      };
    },
    stashCarcass(stow, where = 'into the stores') {
      if (!carrying) return;
      const load = carrying;
      const refused = stow(load.good, load.cu);
      if (refused) {
        opts.hooks.notice(refused);
        return;
      }
      carrying = undefined;
      opts.hooks.notice(`The carcass goes ${where}: ${load.cu} CU of venison.`);
    },
    params(base) {
      if (!carrying) return base;
      const k = opts.woodcraft() ? file.hunt.carcass.woodcraftSpeed : file.hunt.carcass.speed;
      return { ...base, walkSpeed: base.walkSpeed * k, runSpeed: base.walkSpeed * k * 1.15 };
    },
    frame() {
      const st = opts.state();
      return {
        animals: animals
          .filter((a) => !a.taken)
          .map((a) => ({
            id: a.id,
            species: a.species.id,
            state: a.state === 'dead' && a.dressed ? 'dressed' : a.state,
            x: a.x,
            y: a.y,
            z: a.z,
            heading: a.heading,
            moving: a.speed,
          })),
        sign: sign.map((s) => ({ ...s })),
        traps: spots.map((s) => ({ x: s.x, y: s.y, z: s.z, set: !!st.traps[s.id] })),
        carrying: !!carrying,
      };
    },
    spawn(species, at) {
      const def = file.species.find((s) => s.id === species);
      if (!def) return undefined;
      const a = createAnimal(
        `${species.replace('animal.', '')}.${nextId++}`,
        def,
        { x: at.x, y: heightAt(at.x, at.z), z: at.z },
        0,
      );
      animals.push(a);
      return a;
    },
    shoot(player, id) {
      const target = id ? animals.find((a) => a.id === id) : inSights(player);
      return fire(player, target);
    },
  };
}
