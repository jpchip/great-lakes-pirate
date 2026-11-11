import type { CrimeInput, LawEvent } from '../../sim/law/law';
import type { Identification, Witness } from '../../sim/law/witness';
import type { ConductReason } from './conduct';
import type { Guard, Stealth, StealthEvent } from './stealth';
import { guardNoun, type OnFootTools, type ToolEvent } from './tools';

/**
 * Crimes on foot (plan 08 §5.2, §6, §10; Phase 7 piece E): what the guards and the tools do,
 * turned into Phase 5's crime pipeline (`commitCrime`, through the game's law). Each crime
 * is one incident: a second guard reporting the same thing is another witness to it, not
 * another crime, so the heat isn't counted twice.
 *
 * - **Seen where you shouldn't be:** a guard who reports seeing you files the crime your
 *   conduct made of it when he spotted you: trespass, or theft when you had loot, or the
 *   assault or murder when you were carrying the man. Seen only because he knew your face,
 *   there's no new crime.
 * - **A blow or a knife someone saw:** assault or murder at once, with those who saw it.
 * - **A man coshed unseen** reports an assault when he wakes (his report travels as his
 *   kind's does): by you if he'd learned your face, else by "someone" (the region's alert
 *   rises, not its heat).
 * - **A body found** opens a murder investigation. With nobody to say who, it ties the
 *   killing to any face a guard learned in the district tonight, else to "someone".
 * - **A refused bribe** to a constable or marshal is reported at once.
 * - **Whiskey** is a gift: a drunk who slept it off reports nothing.
 */

export interface FootLawHooks {
  commit(input: CrimeInput): LawEvent[];
  addWitness(crimeId: string, witness: Witness): LawEvent[];
}

export interface FootLawPlace {
  /** The region the district is in (`region.apostles` for Bayfield). */
  region: string;
  port?: string;
}

export interface FootLaw {
  /** Every event the law raised from on foot, oldest first. */
  readonly events: readonly LawEvent[];
  /** The crime opened for each incident: `seen:crime.trespass`, `victim:<guard id>`. */
  readonly incidents: ReadonlyMap<string, string>;
  dispose(): void;
}

/** What a guard seeing you, with this conduct, makes of it (no crime: undefined). */
export function crimeForSighting(
  reason: ConductReason | undefined,
  carriedDead: boolean | undefined,
): string | undefined {
  switch (reason) {
    case undefined:
      return undefined;
    case 'body':
      return carriedDead ? 'crime.killing' : 'crime.assault';
    case 'loot':
      return 'crime.petty_theft';
    default:
      return 'crime.trespass';
  }
}

/** A guard as a witness to the law (plan 06 §2.4). */
export function guardWitness(g: Guard, identification?: Identification): Witness {
  return {
    id: g.id,
    kind: g.type.witness,
    name: guardNoun(g),
    identification: identification ?? (g.identified ? 'person' : 'unknown'),
  };
}

export function createFootLaw(
  stealth: Stealth,
  tools: OnFootTools | undefined,
  hooks: FootLawHooks,
  place: FootLawPlace,
  /** Conduct right now (the reason only). */
  conductNow: () => ConductReason | undefined,
): FootLaw {
  const events: LawEvent[] = [];
  const incidents = new Map<string, string>();
  /** The conduct each guard saw when he spotted you. */
  const sawYou = new Map<string, { reason: ConductReason | undefined; carriedDead: boolean }>();
  /** Someone in the district learned your face tonight. */
  let faceKnown = false;

  const record = (evs: LawEvent[]): string | undefined => {
    events.push(...evs);
    const c = evs.find((e) => e.type === 'CrimeCommitted');
    return c?.type === 'CrimeCommitted' ? c.crimeId : undefined;
  };

  /** One crime per incident: commit it the first time, add witnesses after. */
  const incident = (
    key: string,
    crime: string,
    witnesses: Witness[],
    details?: CrimeInput['details'],
  ): void => {
    const open = incidents.get(key);
    if (open) {
      for (const w of witnesses) record(hooks.addWitness(open, w));
      return;
    }
    const id = record(
      hooks.commit({
        crime,
        region: place.region,
        ...(place.port ? { port: place.port } : {}),
        witnesses,
        ...(details ? { details } : {}),
      }),
    );
    if (id) incidents.set(key, id);
  };

  const guard = (id: string): Guard | undefined => stealth.guard(id);

  const onStealth = (e: StealthEvent): void => {
    switch (e.type) {
      case 'PlayerIdentified':
        faceKnown = true;
        return;
      case 'PlayerSpotted': {
        const carried = tools?.carrying ? guard(tools.carrying) : undefined;
        sawYou.set(e.npc, { reason: conductNow(), carriedDead: carried?.state === 'dead' });
        return;
      }
      case 'GuardReported': {
        const g = guard(e.npc);
        if (!g) return;
        if (e.why === 'seen') {
          const saw = sawYou.get(e.npc);
          const crime = crimeForSighting(saw?.reason, saw?.carriedDead);
          if (!crime) return;
          // Carrying a man is that man's crime; anything else is one incident a kind.
          const key =
            saw?.reason === 'body' && tools?.carrying
              ? `victim:${tools.carrying}`
              : `seen:${crime}`;
          incident(key, crime, [guardWitness(g)]);
        }
        // `assault` is GuardWoke's below, and `body` BodyFound's, whoever found it.
        return;
      }
      case 'GuardWoke': {
        // He came round from a blow: he tells of it, as his kind does (a constable at once,
        // a watchman when he's found one), by you if he'd learned your face. Drink is no crime.
        const g = guard(e.npc);
        if (!g || e.drank) return;
        incident(`victim:${g.id}`, 'crime.assault', [guardWitness(g)], { victim: guardNoun(g) });
        return;
      }
      case 'BodyFound': {
        if (!e.dead) return;
        const finder = guard(e.finder);
        const victim = guard(e.npc);
        if (!finder || !victim) return;
        // The murder investigation: a face seen on the docks tonight is the first suspect.
        incident(
          `victim:${victim.id}`,
          'crime.killing',
          [guardWitness(finder, faceKnown ? 'person' : 'unknown')],
          { victim: guardNoun(victim), killed: 1 },
        );
        return;
      }
      default:
        return;
    }
  };

  const onTool = (e: ToolEvent): void => {
    switch (e.type) {
      case 'KnockedOut':
      case 'Killed': {
        if (e.seenBy.length === 0) return;
        const victim = guard(e.npc);
        const witnesses = e.seenBy.flatMap((id) => {
          const g = guard(id);
          return g ? [guardWitness(g)] : [];
        });
        const killing = e.type === 'Killed';
        incident(
          `victim:${e.npc}`,
          killing ? 'crime.killing' : 'crime.assault',
          witnesses,
          victim ? { victim: guardNoun(victim), ...(killing ? { killed: 1 } : {}) } : undefined,
        );
        return;
      }
      case 'BribeRefused': {
        const g = guard(e.npc);
        if (!e.reports || !g) return;
        // Face to face: he knows who offered.
        incident(`bribe:${g.id}`, 'crime.bribery', [guardWitness(g, 'person')]);
        return;
      }
      default:
        return;
    }
  };

  const offStealth = stealth.on(onStealth);
  const offTools = tools?.on(onTool);
  return {
    events,
    incidents,
    dispose() {
      offStealth();
      offTools?.();
    },
  };
}
