import { z } from 'zod';
import eventsJson from '../../../data/events.json';
import {
  eventsFileSchema,
  type EventChannel,
  type EventChoiceDef,
  type EventDef,
  type EventsFile,
} from '../../../data/schemas/events';
import { calendarDate, SECONDS_PER_GAME_DAY } from '../../core/time';

/**
 * Sandbox events and letters (plan 12 §5, plan 11 §18.4 piece A). Pure functions on plain
 * data: which events' triggers hold, the weighted draw, firing one at a port, its ending,
 * and the letters it leaves at the harbor masters'. What an outcome does to the markets,
 * the law or the hideouts is applied by `gameplay/events.ts`; what the sim asks of a
 * standing event (a payroll in a strongbox, the cutter's lean, crews drinking easy, the
 * saloons' talk) is answered here from the saved state.
 *
 * The save keeps `events {active, cooldowns, flags, fired, nextCheckAt, nextKey}` and
 * `mail[]` (plan 12 §10), both optional: a run from before them starts with none, so no
 * version bump.
 */

export const EVENTS: EventsFile = eventsFileSchema.parse(eventsJson);

export function eventDef(id: string, defs: EventsFile = EVENTS): EventDef | undefined {
  return defs.events.find((e) => e.id === id);
}

const HOUR = 3600;

/** An event standing now: where, until when, and what it fixed as it fired. */
export const activeEventSchema = z.object({
  /** Unique in the run: `ev.<n>`. */
  key: z.string(),
  id: z.string(),
  at: z.number(),
  until: z.number(),
  port: z.string().optional(),
  region: z.string().optional(),
  /** The payroll's ship, her name, when she sails and the cash in her strongbox. */
  ship: z.string().optional(),
  shipName: z.string().optional(),
  sailsAt: z.number().optional(),
  cents: z.number().int().optional(),
  /** The wrecking mark a moon-cussing night's ship is due past (Phase 9 piece I). */
  markName: z.string().optional(),
  /** The hideout an informant knows of. */
  hideout: z.string().optional(),
  hideoutName: z.string().optional(),
  /** The choice taken (a letter, a chart meeting or a scene) and when. */
  chosen: z.string().optional(),
  /** A chart meeting or a scene not yet shown. */
  scenePending: z.boolean().optional(),
});
export type ActiveEvent = z.infer<typeof activeEventSchema>;

export const eventsStateSchema = z.object({
  active: z.array(activeEventSchema),
  /** When each event last fired. */
  cooldowns: z.record(z.string(), z.number()),
  flags: z.array(z.string()),
  /** Times each event has fired this run. */
  fired: z.record(z.string(), z.number().int().nonnegative()),
  /** The next draw. */
  nextCheckAt: z.number(),
  nextKey: z.number().int().positive(),
  /** No event fires before this (a run's first week, plan 12 §3). */
  graceUntil: z.number().optional(),
});
export type EventsState = z.infer<typeof eventsStateSchema>;

/** A letter waiting at the harbor masters' (plan 12 §5.1: a simple mail system). */
export const letterSchema = z.object({
  /** The event's key. */
  key: z.string(),
  event: z.string(),
  at: z.number(),
  from: z.string(),
  subject: z.string(),
  body: z.string(),
  read: z.boolean(),
  /** Its choices are still open (the event stands and none was taken). */
  open: z.boolean(),
  /** What came of the answer. */
  result: z.string().optional(),
});
export type Letter = z.infer<typeof letterSchema>;
export const mailSchema = z.array(letterSchema);

export function createEventsState(now: number, defs: EventsFile = EVENTS): EventsState {
  return {
    active: [],
    cooldowns: {},
    flags: [],
    fired: {},
    nextCheckAt: now + defs.rules.graceDays * SECONDS_PER_GAME_DAY,
    nextKey: 1,
    graceUntil: now + defs.rules.graceDays * SECONDS_PER_GAME_DAY,
  };
}

/** What the triggers read of the run, and the places the sim offers. */
export interface EventWorld {
  now: number;
  fameTier: number;
  /** The highest Wanted tier anywhere, and the region it's in. */
  topWanted: { tier: number; region: string | undefined };
  regionOf(port: string): string | undefined;
  standing(port: string): number;
  /** The storm signal flies at the port. */
  gale(port: string): boolean;
  /** Your hideouts, with the Wanted region each lies in. */
  hideouts: readonly { id: string; name: string; region: string }[];
  /** The region you're in (at sea or in port). */
  hereRegion: string | undefined;
  /** The port you're docked at, if any. */
  dockedPort: string | undefined;
  /** The next ship to sail loaded from a port within `days`, for a payroll. */
  sailingFrom?(port: string, days: number): { ship: string; name: string; at: number } | undefined;
  /**
   * A moon-cussing night (Phase 9 piece I): the laden ship due past a wrecking mark after
   * dark, with the moon dark and the weather foul there; undefined when it isn't one.
   */
  wreckingNight?():
    { ship: string; name: string; at: number; mark: string; region: string } | undefined;
}

/** Where the draw is made: the world tick, a voyage's tick, or docking at a port. */
export type EventMoment = 'tick' | 'voyage' | 'dock';

/** Which moment an event is drawn at, by its channels. */
export function momentOf(def: EventDef): EventMoment {
  if (def.channels.includes('chart')) return 'voyage';
  if (def.channels.includes('scene')) return 'dock';
  return 'tick';
}

function inRange(v: number, r: { min?: number | undefined; max?: number | undefined } | undefined) {
  if (!r) return true;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
}

function hourOf(now: number): number {
  return (((now % SECONDS_PER_GAME_DAY) + SECONDS_PER_GAME_DAY) % SECONDS_PER_GAME_DAY) / HOUR;
}

function inHours(h: number, [from, to]: readonly [number, number]): boolean {
  return from <= to ? h >= from && h < to : h >= from || h < to;
}

/** The candidate places an event could fire at now; empty when it can't fire. */
export function candidates(
  def: EventDef,
  state: EventsState,
  world: EventWorld,
  moment: EventMoment,
): { port: string | undefined; region: string | undefined }[] {
  const now = world.now;
  if (def.scripted || momentOf(def) !== moment) return [];
  if (state.active.some((a) => a.id === def.id)) return [];
  const last = state.cooldowns[def.id];
  if (last !== undefined && now - last < def.cooldownDays * SECONDS_PER_GAME_DAY) return [];
  if (def.maxPerRun !== undefined && (state.fired[def.id] ?? 0) >= def.maxPerRun) return [];
  if (def.after?.some((a) => !(state.fired[a] ?? 0))) return [];
  const t = def.triggers;
  if (t.months && !t.months.includes(calendarDate(now).getUTCMonth())) return [];
  if (!inRange(world.fameTier, t.fame)) return [];
  if (!inRange(world.topWanted.tier, t.wanted)) return [];
  if (t.flags?.all?.some((f) => !state.flags.includes(f))) return [];
  if (t.flags?.none?.some((f) => state.flags.includes(f))) return [];
  if (t.hideout !== undefined && t.hideout !== world.hideouts.length > 0) return [];
  if (t.hours && !inHours(hourOf(now), t.hours)) return [];

  let places: { port: string | undefined; region: string | undefined }[];
  if (def.ports) {
    places = def.ports.map((p) => ({ port: p, region: world.regionOf(p) }));
    if (moment === 'dock') places = places.filter((p) => p.port === world.dockedPort);
  } else if (t.wreckingNight) {
    const w = world.wreckingNight?.();
    if (!w) return [];
    places = [{ port: undefined, region: w.region }];
  } else if (def.outcomes.some((o) => o.kind === 'cutter')) {
    places = [{ port: undefined, region: world.topWanted.region }];
  } else if (t.hideout) {
    const h = [...world.hideouts].sort((a, b) => a.id.localeCompare(b.id))[0];
    places = [{ port: undefined, region: h?.region }];
  } else {
    places = [{ port: world.dockedPort, region: world.hereRegion }];
  }
  return places.filter((p) => {
    if (t.standing && p.port && !inRange(world.standing(p.port), t.standing)) return false;
    if (t.gale !== undefined && (!p.port || world.gale(p.port) !== t.gale)) return false;
    if (def.outcomes.some((o) => o.kind === 'payroll')) {
      const o = def.outcomes.find((x) => x.kind === 'payroll');
      if (!p.port || !o || o.kind !== 'payroll' || !world.sailingFrom?.(p.port, o.withinDays))
        return false;
    }
    return true;
  });
}

/** Draws 0–1; the game passes the run's saved RNG, the tests a fixed sequence. */
export type Rand = () => number;

/**
 * The draw at a moment: among the events whose triggers hold, one by weight, at one of its
 * places. Undefined when none can fire, or when there are already `maxActive` standing.
 */
export function drawEvent(
  state: EventsState,
  world: EventWorld,
  moment: EventMoment,
  rand: Rand,
  defs: EventsFile = EVENTS,
): { def: EventDef; port: string | undefined; region: string | undefined } | undefined {
  if (state.active.length >= defs.rules.maxActive) return undefined;
  if (state.graceUntil !== undefined && world.now < state.graceUntil) return undefined;
  const options = defs.events
    .map((def) => ({ def, places: candidates(def, state, world, moment) }))
    .filter((o) => o.places.length > 0);
  const total = options.reduce((s, o) => s + o.def.weight, 0);
  if (total <= 0) return undefined;
  let u = rand() * total;
  let chosen = options[options.length - 1];
  for (const o of options) {
    u -= o.def.weight;
    if (u < 0) {
      chosen = o;
      break;
    }
  }
  if (!chosen) return undefined;
  const place = chosen.places[Math.floor(rand() * chosen.places.length) % chosen.places.length];
  if (!place) return undefined;
  return { def: chosen.def, ...place };
}

/**
 * Fires an event at a place: it stands for its hours, its cooldown starts, and the
 * payroll's ship and cash or the informant's hideout are fixed. The caller applies its
 * outcomes and sends it down its channels.
 */
export function fireEvent(
  state: EventsState,
  world: EventWorld,
  def: EventDef,
  place: { port: string | undefined; region: string | undefined },
  rand: Rand,
): ActiveEvent {
  const now = world.now;
  const ev: ActiveEvent = {
    key: `ev.${state.nextKey++}`,
    id: def.id,
    at: now,
    until: now + def.hours * HOUR,
    ...(place.port ? { port: place.port } : {}),
    ...(place.region ? { region: place.region } : {}),
  };
  for (const o of def.outcomes) {
    if (o.kind !== 'payroll' || !place.port) continue;
    const s = world.sailingFrom?.(place.port, o.withinDays);
    if (!s) continue;
    ev.ship = s.ship;
    ev.shipName = s.name;
    ev.sailsAt = s.at;
    ev.cents = Math.round((o.cents[0] + (o.cents[1] - o.cents[0]) * rand()) / 100) * 100;
    // The payroll is aboard until she's well on her way and then some.
    ev.until = Math.max(ev.until, s.at + SECONDS_PER_GAME_DAY);
  }
  if (def.triggers.wreckingNight) {
    const w = world.wreckingNight?.();
    if (w) {
      ev.ship = w.ship;
      ev.shipName = w.name;
      ev.sailsAt = w.at;
      ev.markName = w.mark;
      ev.until = Math.max(ev.until, w.at + 6 * HOUR);
    }
  }
  if (def.triggers.hideout) {
    const h = [...world.hideouts]
      .sort((a, b) => a.id.localeCompare(b.id))
      .find((x) => x.region === place.region);
    if (h) {
      ev.hideout = h.id;
      ev.hideoutName = h.name;
    }
  }
  if (def.channels.includes('chart') || def.channels.includes('scene')) ev.scenePending = true;
  state.active.push(ev);
  state.cooldowns[def.id] = now;
  state.fired[def.id] = (state.fired[def.id] ?? 0) + 1;
  return ev;
}

/** Events whose time is up, taken off the active list (oldest first). */
export function expireEvents(state: EventsState, now: number): ActiveEvent[] {
  const gone = state.active.filter((a) => now >= a.until);
  if (gone.length) state.active = state.active.filter((a) => now < a.until);
  return gone;
}

export function choiceOf(def: EventDef, id: string | undefined): EventChoiceDef | undefined {
  return id ? def.choices?.find((c) => c.id === id) : undefined;
}

// ---------------------------------------------------------------------------------
// What the sim asks of a standing event

function standing(state: EventsState | undefined, now: number): ActiveEvent[] {
  return (state?.active ?? []).filter((a) => now >= a.at && now < a.until);
}

/** Extra cash in a ship's strongbox: a payroll aboard her now. */
export function payrollCents(state: EventsState | undefined, shipId: string, now: number): number {
  return standing(state, now)
    .filter((a) => a.ship === shipId)
    .reduce((s, a) => s + (a.cents ?? 0), 0);
}

/** The cutter has been ordered to this region. */
export function cutterOrdered(
  state: EventsState | undefined,
  region: string,
  now: number,
  defs: EventsFile = EVENTS,
): boolean {
  return standing(state, now).some(
    (a) => a.region === region && !!eventDef(a.id, defs)?.outcomes.some((o) => o.kind === 'cutter'),
  );
}

/**
 * Moored crews at this port drink easy (half the bottles): the fleet's storm-bound, or
 * you stood an idle crew a round.
 */
export function crewsIdle(
  state: EventsState | undefined,
  port: string,
  now: number,
  defs: EventsFile = EVENTS,
): boolean {
  return standing(state, now).some((a) => {
    if (a.port !== port) return false;
    const def = eventDef(a.id, defs);
    if (!def) return false;
    if (def.outcomes.some((o) => o.kind === 'crewsIdle')) return true;
    return !!choiceOf(def, a.chosen)?.outcomes.some((o) => o.kind === 'crewsIdle');
  });
}

/** Talk for the saloons: each standing event with rumor lines, in its region. */
export interface EventTalk {
  key: string;
  region: string | undefined;
  /** The lines, filled. */
  lines: string[];
  until: number;
}

export function eventTalk(
  state: EventsState | undefined,
  now: number,
  fillFor: (ev: ActiveEvent, template: string) => string,
  defs: EventsFile = EVENTS,
): EventTalk[] {
  const out: EventTalk[] = [];
  for (const a of standing(state, now)) {
    const def = eventDef(a.id, defs);
    if (!def?.rumor || !def.channels.includes('rumor')) continue;
    out.push({
      key: a.key,
      region: a.region,
      lines: def.rumor.map((t) => fillFor(a, t)),
      until: a.until,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------
// Letters

/** Puts a letter in the mail, keeping at most `keepLetters` read ones (newest first). */
export function postLetter(mail: Letter[], letter: Letter, defs: EventsFile = EVENTS): void {
  mail.unshift(letter);
  const keep = defs.rules.keepLetters;
  if (mail.length <= keep) return;
  // Drop the oldest read and closed letters first.
  for (let i = mail.length - 1; i >= 0 && mail.length > keep; i--) {
    const l = mail[i];
    if (l && l.read && !l.open) mail.splice(i, 1);
  }
  if (mail.length > keep) mail.length = keep;
}

export function unreadLetters(mail: readonly Letter[] | undefined): number {
  return (mail ?? []).filter((l) => !l.read).length;
}

/** The channels an event goes out by, as named in the data. */
export function channelsOf(def: EventDef): readonly EventChannel[] {
  return def.channels;
}

/** Fills `{placeholders}` and capitalizes the first letter. */
export function fillText(template: string, values: Record<string, string>): string {
  const text = template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
