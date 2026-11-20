import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { PlacedIsland } from '../../sim/islands/on-foot';
import type { Reporting } from '../../sim/law/witness';
import { footToolsHud, type FootToolsSnapshot } from '../../ui/hud/foot-tools-model';
import type { AshoreScene } from './ashore-scene';
import { CONDUCT_WORDS, isNight, type Conduct, type ConductReason } from './conduct';
import { DEFAULT_CONTROLLER, type CharacterState, type ControllerParams } from './controller';
import { createFootLaw, nextDawn, type FootLawHooks } from './foot-law';
import { gameNpcs } from './guards';
import { LampSet } from './light';
import {
  LocalNavs,
  ownName,
  residentGrids,
  residentLine,
  residentSpawns,
  residentsAbout,
  residentToTalk,
  residentYard,
  syncResidentFates,
  type ResidentFate,
} from './residents';
import { createStealth } from './stealth';
import { createTools, gameTools, type Pockets, type ToolContext } from './tools';
import { skyAt, type Watch, type WatchConditions } from './watch';

/**
 * An island's people on foot where there's no light station (plan 11 §3.3, §18.4 piece Q):
 * Madeline's farmers and La Pointe's villagers, Hermit's fisherman, Basswood's farm. They
 * answer the watch's `Watch` as the keepers do, so the tool belt, the HUD's prompt, the
 * stealth readout and the voices work here as in Bayfield: out on their rounds by day on
 * the keepers' perception, they don't chase, and what they see goes to the law as fast as
 * word leaves the island (`islands.json` `reporting`). By night they're indoors asleep.
 * By day at low Wanted they'll stop for a word.
 */

export interface IslandWatchHooks {
  notice(text: string): void;
  /** A word with a resident, heard (the station's talk cue). */
  talked?(): void;
}

export interface IslandWatchOptions {
  island: PlacedIsland;
  scene: AshoreScene;
  conditions(): WatchConditions;
  tier: number;
  seed: string;
  pockets: Pockets;
  hasWeapon?(id: string): boolean;
  law?: FootLawHooks & { region(): string };
  hooks: IslandWatchHooks;
  /** The residents' fates in the save (`residents`), made if absent. */
  fates(): Record<string, ResidentFate>;
  /** The highest Wanted tier a resident still bids good day at (the keepers' rule). */
  welcomeMaxTier?: number;
  /** Overrides conduct when it returns a value (the dev hook `__glpFoot.suspect`). */
  suspect?(): boolean | undefined;
}

function spotNotice(reporting: Reporting): string {
  switch (reporting) {
    case 'fast':
      return 'Word will be across to town within the hour.';
    case 'medium':
      return 'Word will reach town in a few hours.';
    case 'slow':
      return 'They will row to town with it at dawn.';
  }
}

export function createIslandWatch(opts: IslandWatchOptions): Watch {
  const { island, scene } = opts;
  const now = (): number => opts.conditions().gameSeconds;
  const t0 = now();
  const night = (): boolean => isNight(skyAt(now(), opts.conditions().cloud01));
  const nightAtLanding = night();
  const welcomeMax = opts.welcomeMaxTier ?? 1;
  const welcome = (): boolean => !night() && opts.conditions().wantedTier <= welcomeMax;

  const residents = nightAtLanding ? [] : residentsAbout(island.residents, opts.fates(), t0);
  const nav = new LocalNavs(residentGrids(scene, residents));
  const spawns = residentSpawns(residents, nav, nightAtLanding);
  const stealth = createStealth(
    {
      zone: scene,
      nav,
      lamps: new LampSet([]),
      rng: Rng.fromSeed(`${opts.seed}:island:${island.id}`),
    },
    gameNpcs(),
    spawns,
    opts.tier,
  );
  for (const g of stealth.guards) {
    const p = g.body.position;
    p.y = Math.max(scene.ground.heightAt(p.x, p.z), p.y);
    g.previous.y = p.y;
    const f = opts.fates()[g.id.replace(/^resident\./, '')];
    if (f?.bribedUntil !== undefined && t0 < f.bribedUntil) stealth.bribe(g.id, f.bribedUntil);
  }

  const tools = createTools(
    stealth,
    opts.pockets,
    scene,
    Rng.fromSeed(`${opts.seed}:tools:${island.id}`),
    gameTools(),
    opts.hasWeapon ? { hasWeapon: opts.hasWeapon } : {},
  );

  let lastConduct: Conduct | undefined;
  const footLaw = opts.law
    ? createFootLaw(
        stealth,
        tools,
        opts.law,
        {
          get region() {
            return opts.law?.region() ?? '';
          },
          reporting: island.reporting,
        },
        () => lastConduct?.reason,
      )
    : undefined;

  const conductNow = (p: CharacterState): Conduct => {
    let reason: ConductReason | undefined;
    if (tools.carrying) reason = 'body';
    else if (tools.armed()) reason = 'armed';
    else if (!welcome() && residentYard(residents, p.position)) reason = 'trespass';
    return reason
      ? { suspect: true, reason, words: CONDUCT_WORDS[reason], area: undefined }
      : { suspect: false, reason: undefined, words: '', area: undefined };
  };

  const toolContext = (player: CharacterState): ToolContext => {
    const c = opts.conditions();
    return {
      player,
      gameSeconds: c.gameSeconds,
      wantedTier: c.wantedTier,
      fame01: c.fame01,
      light01: stealth.readout().light.level01,
    };
  };

  const talkedTo = new Set<string>();
  /** A word with a resident at his work, by day at low Wanted. */
  const talkOffer = (p: CharacterState): { label: string; act(): void } | undefined => {
    if (tools.carrying || !p.grounded || p.swimming || !welcome()) return undefined;
    const local = residentToTalk(stealth, residents, p.position);
    if (!local || talkedTo.has(local.resident.id)) return undefined;
    const { guard, resident } = local;
    return {
      label: `Talk with ${ownName(guard.name)}`,
      act: () => {
        talkedTo.add(resident.id);
        opts.hooks.talked?.();
        const c = opts.conditions();
        stealth.faceToFace(guard.id, stealth.readout().light.level01, c.fame01);
        const day = dayAndHour(now()).day;
        opts.hooks.notice(`${ownName(guard.name)}: "${residentLine(resident, day)}"`);
      },
    };
  };

  let spotWarned = false;
  stealth.on((e) => {
    if (e.type !== 'PlayerSpotted' || spotWarned) return;
    spotWarned = true;
    opts.hooks.notice(`You've been seen. ${spotNotice(island.reporting)}`);
  });

  /** A hostile tool beats a word; a coin or a bottle waits for the talk. */
  const toolFirst = (player: CharacterState): boolean => {
    const o = tools.offer(toolContext(player));
    if (!o || tools.lowPriority(o)) return false;
    if ((o.verb === 'bribe' || o.verb === 'whiskey') && talkOffer(player)) return false;
    return true;
  };

  let holdS = -1;
  return {
    stealth,
    tier: opts.tier,
    get pursued() {
      return false;
    },
    get searched() {
      return stealth.guards.some((g) => g.state === 'search');
    },
    step(dt, player, lean) {
      const c = opts.conditions();
      lastConduct = conductNow(player);
      const forced = opts.suspect?.();
      stealth.step(dt, {
        player,
        playerParams: DEFAULT_CONTROLLER,
        ...(scene.surfaceAt
          ? { surface: scene.surfaceAt(player.position.x, player.position.z) }
          : {}),
        sky: skyAt(c.gameSeconds, c.cloud01),
        fogM: c.fogM,
        rain01: c.rain01,
        gameSeconds: c.gameSeconds,
        carrying: tools.carrying !== undefined,
        suspect: forced ?? lastConduct.suspect,
        fame01: c.fame01,
        wantedTier: c.wantedTier,
        ...(lean ? { lean } : {}),
      });
      tools.step(toolContext(player));
      syncResidentFates(stealth.guards, opts.fates(), c.gameSeconds, nextDawn);
    },
    readout: () => stealth.readout(),
    on: (fn) => stealth.on(fn),
    tools,
    footLaw,
    get conduct() {
      return lastConduct;
    },
    arrestReason: () => lastConduct?.reason,
    offer: (player) => tools.offer(toolContext(player)),
    interact(dt, player, down, pressed, otherPrompt = false) {
      if (toolFirst(player)) {
        const o = tools.offer(toolContext(player));
        if (!o) return false;
        if (pressed) {
          if (o.holdS > 0) holdS = 0;
          else tools.use(toolContext(player));
          return true;
        }
        if (holdS >= 0) {
          if (!down || !o.ok || o.holdS <= 0) holdS = -1;
          else if ((holdS += dt) >= o.holdS) {
            tools.use(toolContext(player));
            holdS = -1;
          }
        }
        return true;
      }
      holdS = -1;
      const talk = otherPrompt ? undefined : talkOffer(player);
      if (talk) {
        if (pressed) talk.act();
        return true;
      }
      // A throw, last of all.
      const o = tools.offer(toolContext(player));
      if (o && !otherPrompt && pressed && o.ok) tools.use(toolContext(player));
      return !!o && !otherPrompt;
    },
    heist: undefined,
    jailbreak: undefined,
    moored: [],
    alongside: () => false,
    crews: () => [],
    crowd: () => [],
    standCrew: () => 'Not now',
    params(base: ControllerParams): ControllerParams {
      return base;
    },
    onHeist: () => () => undefined,
    toolsHud(player, otherPrompt = false): FootToolsSnapshot | undefined {
      const o = tools.offer(toolContext(player));
      const first = toolFirst(player);
      const talk = first || otherPrompt ? undefined : talkOffer(player);
      const shown =
        first || !talk ? (o && (!tools.lowPriority(o) || !otherPrompt) ? o : undefined) : undefined;
      const hold01 = shown && shown.holdS > 0 && holdS >= 0 ? holdS / shown.holdS : 0;
      return footToolsHud(
        tools,
        lastConduct ?? conductNow(player),
        shown,
        hold01,
        opts.pockets.purse,
        talk
          ? { prompt: { key: 'F', label: talk.label, ok: true, why: '', hold01: 0 }, load: '' }
          : undefined,
      );
    },
    onTool: (fn) => tools.on(fn),
    lamps: [],
    douseOffer: () => undefined,
    douseLamp: () => undefined,
  };
}
