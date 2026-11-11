import toolsJson from '../../../data/tools.json';
import { toolsFileSchema, type ToolDef, type ToolsFile } from '../../../data/schemas/tools';
import type { Rng } from '../../core/rng';
import type { CharacterState, OnFootZone } from './controller';
import { isDown, type Guard, type Stealth } from './stealth';

/**
 * The quiet ways past a guard (plan 08 §6; Phase 7 piece E): the cosh and the knife from
 * behind, rope for a man out cold, a bottle of whiskey, the purse, and carrying a man off
 * into the dark or the lake. One tool is in hand at a time (the tool belt); F does what the
 * tool in hand can do to the guard in front of you, and the prompt says what that is, or
 * why not, before you press it.
 *
 * - **Cosh:** from behind (outside the corner of his eye) or at a drunk, he's out for two
 *   game hours, wakes and reports an assault by "someone" (by you, if he'd seen your face).
 * - **Knife:** the same approach; he's dead, and his body found is a murder.
 * - **Rope:** tie a man who's out cold: he's out six hours, and stays down when found.
 * - **Whiskey:** offered face to face. A sailor nearly always drinks, a watchman often, a
 *   constable seldom; he's slow and half-blind, then asleep within the hour, and wakes with
 *   nothing to report. A refusal makes a constable wary.
 * - **Bribe:** face to face, at his price (more at each Wanted tier). Taken, he looks away
 *   for six game hours; refused, he's wary, and a constable or marshal reports it. A man
 *   who refused won't be asked twice tonight.
 * - **Carrying a man:** pick up anyone down, carry him (slow, loud, unmistakable), put him
 *   down in the shadows or drop him off a pier: a man out cold drowns, and the lake keeps
 *   the body.
 *
 * Everything that happens comes out as a `ToolEvent`; `foot-law.ts` turns them into crimes.
 */

export interface ToolDefs {
  file: ToolsFile;
  byId: ReadonlyMap<string, ToolDef>;
  belt: readonly ToolDef[];
}

export function compileTools(file: ToolsFile): ToolDefs {
  return { file, byId: new Map(file.tools.map((t) => [t.id, t])), belt: file.tools };
}

let cached: ToolDefs | undefined;

export function gameTools(): ToolDefs {
  cached ??= compileTools(toolsFileSchema.parse(toolsJson));
  return cached;
}

/** What you carry: cash in cents and the ship's stores (the cosh, rope and bottles). */
export interface Pockets {
  purse: number;
  stores: Record<string, number>;
}

export type ToolVerb = 'knockOut' | 'kill' | 'bind' | 'whiskey' | 'bribe' | 'lift' | 'drop';

/** What F does now: the prompt. */
export interface Offer {
  verb: ToolVerb;
  tool: ToolDef | undefined;
  /** The guard it's done to. */
  target: string | undefined;
  /** "Knock out the night watchman", "Bribe the constable ($15.00)". */
  label: string;
  ok: boolean;
  /** Why not, when not ok. */
  why?: string;
  /** Hold F this long (tying a man up). */
  holdS: number;
  priceCents?: number;
}

export type ToolEvent =
  | { type: 'KnockedOut'; npc: string; seenBy: string[] }
  | { type: 'Killed'; npc: string; seenBy: string[] }
  | { type: 'Bound'; npc: string }
  | { type: 'BribePaid'; npc: string; cents: number }
  | { type: 'BribeRefused'; npc: string; reports: boolean }
  | { type: 'WhiskeyTaken'; npc: string }
  | { type: 'WhiskeyRefused'; npc: string }
  | { type: 'BodyLifted'; npc: string }
  | { type: 'BodyDropped'; npc: string; sunk: boolean; drowned: boolean };

/** The world around the tools each tick. */
export interface ToolContext {
  player: CharacterState;
  gameSeconds: number;
  wantedTier: number;
  fame01: number;
  /** The light on the player now (the stealth readout's), 0–1: how well a face is seen. */
  light01: number;
}

export interface OnFootTools {
  readonly defs: ToolDefs;
  /** The tool in hand. */
  readonly selected: ToolDef;
  select(id: string): void;
  /** Selects the belt's n-th tool (0-based), if there is one. */
  selectSlot(n: number): void;
  /** How many of a tool you have: Infinity for one always to hand. */
  count(tool: ToolDef): number;
  /** The man you're carrying. */
  readonly carrying: string | undefined;
  /** A drawn tool (cosh, knife) is in hand and you have one: conduct's "armed". */
  armed(): boolean;
  /** What F would do now, or nothing in reach. */
  offer(ctx: ToolContext): Offer | undefined;
  /** Does it (if it's ok). */
  use(ctx: ToolContext): ToolEvent[];
  /** Each tick after the guards: a carried man goes where you go. */
  step(ctx: ToolContext): void;
  on(fn: (e: ToolEvent) => void): () => void;
}

/** A guard's name in a sentence: "the night watchman". */
export function guardNoun(g: Guard): string {
  return g.name.toLowerCase().startsWith('the ') ? g.name : `the ${g.name.toLowerCase()}`;
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Whether the player stands outside the corner of a guard's eye (plan 08 §6: from behind). */
export function behind(g: Guard, p: { x: number; z: number }, cone = 1): boolean {
  const at = g.body.position;
  const toPlayer = Math.atan2(p.x - at.x, -(p.z - at.z));
  const off = Math.abs(wrapAngle(toPlayer - g.body.heading));
  return off > ((g.type.sight.peripheralDeg / 2) * cone * Math.PI) / 180;
}

/** A bribe's price for a guard at a Wanted tier, cents. */
export function bribePrice(defs: ToolDefs, g: Guard, tier: number): number {
  const base = defs.file.bribe.priceCents[g.type.id] ?? 1000;
  return Math.round(base * (1 + defs.file.bribe.perTier * Math.max(0, tier)));
}

/** The chance a guard takes a bribe now (npc_types' `bribeChance`, less if he's wary or knows you). */
export function bribeChance(defs: ToolDefs, g: Guard, tier: number): number {
  const b = defs.file.bribe;
  let p = g.type.bribeChance;
  if (g.identified && tier >= 2) p *= b.knownFace;
  if (g.state === 'suspicious' || g.state === 'search') p *= b.wary;
  return p;
}

/** The chance a guard takes a drink on duty now. */
export function whiskeyChance(defs: ToolDefs, g: Guard): number {
  const w = defs.file.whiskey;
  const p = w.accept[g.type.id] ?? 0;
  return g.state === 'suspicious' ? p * w.wary : p;
}

/** States a man can be talked to in: on his beat or merely wondering. */
function talkable(g: Guard): boolean {
  return g.state === 'patrol' || g.state === 'return' || g.state === 'suspicious';
}

/** Down, and not someone you're already carrying. */
const liftable = (g: Guard): boolean => isDown(g.state);

export function createTools(
  stealth: Stealth,
  pockets: Pockets,
  zone: OnFootZone,
  rng: Rng,
  defs: ToolDefs = gameTools(),
): OnFootTools {
  const listeners = new Set<(e: ToolEvent) => void>();
  const emit = (out: ToolEvent[], e: ToolEvent): void => {
    out.push(e);
    for (const fn of listeners) fn(e);
  };
  let selected: ToolDef = defs.belt[0] as ToolDef;
  let carrying: string | undefined;
  /** Who said no tonight, to money or drink. */
  const refusedBribe = new Set<string>();
  const refusedDrink = new Set<string>();

  const count = (t: ToolDef): number => (t.store ? (pockets.stores[t.store] ?? 0) : Infinity);
  const spend = (t: ToolDef): void => {
    if (t.store) pockets.stores[t.store] = Math.max(0, (pockets.stores[t.store] ?? 0) - 1);
  };

  const nearest = (
    ctx: ToolContext,
    reachM: number,
    which: (g: Guard) => boolean,
  ): Guard | undefined => {
    const p = ctx.player.position;
    let best: Guard | undefined;
    let bestD = reachM;
    for (const g of stealth.guards) {
      if (!which(g) || g.id === carrying) continue;
      const d = Math.hypot(g.body.position.x - p.x, g.body.position.z - p.z);
      if (d <= bestD && Math.abs(g.body.position.y - p.y) < 1.6) {
        bestD = d;
        best = g;
      }
    }
    return best;
  };

  /** What the tool in hand can do to the nearest man it can be used on. */
  const toolOffer = (ctx: ToolContext): Offer | undefined => {
    const t = selected;
    const p = ctx.player.position;
    const have = count(t);
    switch (t.kind) {
      case 'blunt':
      case 'blade': {
        const g = nearest(ctx, t.reachM, (o) => !isDown(o.state));
        if (!g) return undefined;
        const verb = t.kind === 'blunt' ? 'knockOut' : 'kill';
        const label = `${t.kind === 'blunt' ? 'Knock out' : 'Kill'} ${guardNoun(g)}`;
        const base = { verb, tool: t, target: g.id, label, holdS: t.holdS } as const;
        if (have <= 0) return { ...base, ok: false, why: `No ${t.name.toLowerCase()}` };
        if (g.state === 'alerted') return { ...base, ok: false, why: "He's on to you" };
        if (g.state !== 'drunk' && !behind(g, p, defs.file.takedown.behindCone)) {
          return { ...base, ok: false, why: "He'd see you coming: get behind him" };
        }
        return { ...base, ok: true };
      }
      case 'bind': {
        const g = nearest(ctx, t.reachM, (o) => o.state === 'unconscious');
        if (!g) return undefined;
        const base = {
          verb: 'bind',
          tool: t,
          target: g.id,
          label: `Tie up ${guardNoun(g)}`,
          holdS: t.holdS,
        } as const;
        return have > 0 ? { ...base, ok: true } : { ...base, ok: false, why: 'No rope' };
      }
      case 'gift':
      case 'bribe': {
        const g = nearest(ctx, t.reachM, (o) => !isDown(o.state));
        if (!g) return undefined;
        const gift = t.kind === 'gift';
        const price = gift ? undefined : bribePrice(defs, g, ctx.wantedTier);
        const base = {
          verb: gift ? 'whiskey' : 'bribe',
          tool: t,
          target: g.id,
          label: gift
            ? `Offer ${guardNoun(g)} a drink`
            : `Bribe ${guardNoun(g)} (${dollars(price ?? 0)})`,
          holdS: t.holdS,
          ...(price !== undefined ? { priceCents: price } : {}),
        } as const;
        if (gift && have <= 0) return { ...base, ok: false, why: 'No whiskey' };
        if (!gift && g.type.bribeChance <= 0) {
          return { ...base, ok: false, why: "He can't be bought" };
        }
        if ((gift ? refusedDrink : refusedBribe).has(g.id)) {
          return { ...base, ok: false, why: gift ? "He won't drink with you" : 'He said no' };
        }
        if (g.state === 'bribed' || g.state === 'drunk') {
          return { ...base, ok: false, why: gift ? 'He has had enough' : 'Already paid' };
        }
        if (!talkable(g)) return { ...base, ok: false, why: "He's in no mood to talk" };
        if (behind(g, p, 0.6)) return { ...base, ok: false, why: 'Get in front of him' };
        if (price !== undefined && pockets.purse < price) {
          return { ...base, ok: false, why: 'Not enough money' };
        }
        return { ...base, ok: true };
      }
    }
  };

  const self: OnFootTools = {
    defs,
    get selected() {
      return selected;
    },
    select(id) {
      const t = defs.byId.get(id);
      if (t) selected = t;
    },
    selectSlot(n) {
      const t = defs.belt[n];
      if (t) selected = t;
    },
    count,
    get carrying() {
      return carrying;
    },
    armed() {
      return selected.drawn && count(selected) > 0 && carrying === undefined;
    },
    offer(ctx) {
      if (carrying) {
        const g = stealth.guard(carrying);
        return {
          verb: 'drop',
          tool: undefined,
          target: carrying,
          label: `Put ${g ? guardNoun(g) : 'him'} down`,
          ok: true,
          holdS: 0,
        };
      }
      if (ctx.player.swimming) return undefined;
      const fromTool = toolOffer(ctx);
      if (fromTool) return fromTool;
      const down = nearest(ctx, 1.6, liftable);
      if (!down) return undefined;
      return {
        verb: 'lift',
        tool: undefined,
        target: down.id,
        label: `Pick up ${guardNoun(down)}`,
        ok: true,
        holdS: 0.5,
      };
    },
    use(ctx) {
      const out: ToolEvent[] = [];
      const o = self.offer(ctx);
      if (!o || !o.ok || !o.target) return out;
      const g = stealth.guard(o.target);
      if (!g) return out;
      const now = ctx.gameSeconds;
      const p = ctx.player.position;
      switch (o.verb) {
        case 'knockOut':
        case 'kill': {
          const t = o.tool as ToolDef;
          // Whoever's looking sees the blow; then he drops.
          const seenBy = stealth.witnessAct(g.id).map((w) => w.id);
          if (o.verb === 'knockOut') {
            stealth.knockOut(g.id, now, defs.file.takedown.outH * 3600);
            emit(out, { type: 'KnockedOut', npc: g.id, seenBy });
          } else {
            stealth.kill(g.id);
            emit(out, { type: 'Killed', npc: g.id, seenBy });
          }
          if (t.noiseM > 0) {
            stealth.noise({
              kind: 'blow',
              x: g.body.position.x,
              y: g.body.position.y,
              z: g.body.position.z,
              radiusM: t.noiseM,
              source: 'player',
            });
          }
          return out;
        }
        case 'bind':
          spend(o.tool as ToolDef);
          stealth.bind(g.id, now);
          emit(out, { type: 'Bound', npc: g.id });
          return out;
        case 'whiskey': {
          stealth.faceToFace(g.id, ctx.light01, ctx.fame01);
          if (rng.chance(whiskeyChance(defs, g))) {
            spend(o.tool as ToolDef);
            const [lo, hi] = defs.file.whiskey.passOutMin;
            stealth.makeDrunk(g.id, now, rng.range(lo, hi) * 60);
            emit(out, { type: 'WhiskeyTaken', npc: g.id });
          } else {
            refusedDrink.add(g.id);
            if (g.type.onAlert === 'report') stealth.wary(g.id);
            emit(out, { type: 'WhiskeyRefused', npc: g.id });
          }
          return out;
        }
        case 'bribe': {
          const price = o.priceCents ?? 0;
          const chance = bribeChance(defs, g, ctx.wantedTier);
          stealth.faceToFace(g.id, ctx.light01, ctx.fame01);
          if (rng.chance(chance)) {
            pockets.purse -= price;
            stealth.bribe(g.id, now + defs.file.bribe.hours * 3600);
            emit(out, { type: 'BribePaid', npc: g.id, cents: price });
          } else {
            refusedBribe.add(g.id);
            stealth.wary(g.id);
            emit(out, { type: 'BribeRefused', npc: g.id, reports: g.type.onAlert === 'report' });
          }
          return out;
        }
        case 'lift':
          carrying = g.id;
          emit(out, { type: 'BodyLifted', npc: g.id });
          self.step(ctx);
          return out;
        case 'drop': {
          carrying = undefined;
          // Down at your feet, a step ahead.
          const h = ctx.player.heading;
          const x = p.x + Math.sin(h) * 0.9;
          const z = p.z - Math.cos(h) * 0.9;
          const ground = zone.ground.heightAt(x, z);
          const inWater = ground < zone.waterLevel - 0.3 && p.y < zone.waterLevel + 3;
          // On the ground or a deck at your height; the guards' own step settles him.
          stealth.moveBody(g.id, { x, y: inWater ? ground : Math.max(ground, p.y), z });
          let drowned = false;
          if (inWater) {
            drowned = g.state !== 'dead';
            stealth.sink(g.id);
          }
          emit(out, { type: 'BodyDropped', npc: g.id, sunk: inWater, drowned });
          return out;
        }
      }
      return out;
    },
    step(ctx) {
      if (!carrying) return;
      const g = stealth.guard(carrying);
      if (!g || !isDown(g.state)) {
        carrying = undefined;
        return;
      }
      // Over the shoulder: just behind and above you, so he's seen with you.
      const p = ctx.player.position;
      const h = ctx.player.heading;
      stealth.moveBody(g.id, {
        x: p.x - Math.sin(h) * 0.3,
        y: p.y + 1.1,
        z: p.z + Math.cos(h) * 0.3,
      });
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return self;
}
