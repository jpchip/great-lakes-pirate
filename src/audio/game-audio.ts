import { AudioContext as SharedAudioContext } from 'three';
import { calendarDate, dayAndHour } from '../core/time';
import { headSeaAmplitude } from '../sim/sailing/controller';
import { sunAt } from '../sim/weather/celestial';
import { seaScaleAt } from '../sim/weather/waves';
import type { GameContext } from '../modes/context';
import type { Entity } from '../gameplay/ecs';
import { loadSoundBank, soundUrls, type SoundBank } from './bank';
import {
  CHART_AUDIO_BUNDLE,
  CHART_MUSIC_BUNDLE,
  CHART_MUSIC_CUE,
  ChartCues,
  ChartMusic,
  stingerFor,
} from './chart-audio';
import { CaptionFeed, type CaptionView } from './captions';
import { FOOT_AUDIO_BUNDLE, FootSounds, type FootFrame } from './foot-audio';
import { HARBOR_AUDIO_BUNDLE, HarborWorks } from './harbor-audio';
import { LAW_AUDIO_BUNDLE, LawSounds, type LawShipId, type LawShipView } from './law-audio';
import {
  COMBAT_AUDIO_BUNDLE,
  COMBAT_MUSIC_BUNDLE,
  CombatSounds,
  type ShotView,
} from './combat-audio';
import { gunKindOf, type GunKind, type Vec3 } from './combat-mix';
import { gameCombat } from '../sim/combat/defs';
import { PLAYER_ID } from '../gameplay/combat';
import { isLawShip } from '../gameplay/law-at-sea';
import { TUG_ID } from '../gameplay/law-ships';
import type { WorkSite } from './harbor-mix';
import { PORT_AUDIO_BUNDLE, TradeCues } from './port-audio';
import { AudioMixer, placeListener, unlockAudio, type AudioPoint, type AudioState } from './mixer';
import { MusicDirector, createStreamPlayer, type MusicPlayer } from './music';
import { SailingSoundscape } from './sailing-audio';
import { loadAudioSettings, saveAudioSettings, type VolumeId } from './settings';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { ShipWhistles, type WhistleShip } from './ship-whistles';
import { WorldSoundscape, type SignalStation } from './world-audio';
import { fogMix, musicMood, type MusicMood } from './world-mix';

/**
 * Audio for the running game: the mixer on three.js's shared AudioContext (plan 01 §2),
 * the autoplay unlock, the sailing soundscape fed from the player's ship each frame, the
 * world around it (weather, fog signals, birds; Phase 2 piece H), the NPC ships' whistles
 * (Phase 3 piece J), open-water music, and on the chart its theme and the encounter
 * stingers, with the fade-to-fog sound under each loading screen (piece J, part 2);
 * since Phase 4 piece J, the harbors at work, the trade sounds at the port screen, and
 * captions for the fog signals and whistles; since Phase 5 piece H, the law: Wanted
 * stingers, the cutter's whistle, engine, bell and gun, and the lockup's door; since
 * Phase 6 piece G, combat: the guns, the round in flight and where it lands, the boiler,
 * the grapple and the boarding vignette, her crew as she strikes, and the chase layer;
 * since Phase 7 piece I, the captain ashore: footsteps, the burglar's kit, the watch's
 * voices, the stealth layer and the places he walks, with the weather still over him.
 */

export const SAILING_AUDIO_BUNDLE = 'sailing-audio';
export const WORLD_AUDIO_BUNDLE = 'world-audio';
export const MUSIC_BUNDLE = 'music-open-water';
export const MUSIC_CUES: Readonly<Record<Exclude<MusicMood, 'quiet'>, string>> = {
  day: 'music.open-water.day',
  night: 'music.open-water.night',
};

/** Where the ears are: the camera, and which way it looks (zone axes). */
export interface ListenerPose {
  at: AudioPoint;
  forward: AudioPoint;
}

export interface GameAudio {
  mixer: AudioMixer;
  bank: SoundBank;
  sailing: SailingSoundscape;
  world: WorldSoundscape;
  whistles: ShipWhistles;
  music: MusicDirector;
  chartMusic: ChartMusic;
  chartCues: ChartCues;
  harbor: HarborWorks;
  trade: TradeCues;
  law: LawSounds;
  combat: CombatSounds;
  foot: FootSounds;
  captions: CaptionFeed;
  /** The captions showing now, with arrows from the listener's view (plan 15 §5). */
  captionsNow(): CaptionView[];
  /** The port screen or the journal opened (true) or the last one closed (false). */
  portScreen(open: boolean): void;
  /** The music mood now, for the dev panel. */
  readonly mood: MusicMood;
  /**
   * Call once per rendered frame with the current mode, and whether the loading fade is up
   * (its rising edge plays the fade-to-fog sound).
   */
  update(frameSeconds: number, mode: string | undefined, loading?: boolean): void;
  /** Hear from the camera instead of the ship once there is one. */
  setListener(pose: () => ListenerPose): void;
  /** The combat core's shots and the targets' captains, once they're attached (piece G). */
  setCombatSource(source: CombatSource): void;
  /** What the sounds ashore read each frame: undefined while you're not on your feet. */
  setFootSource(source: FootSource): void;
  /** A new zone's fog signals, harbors and harbor work sites (Phase 3 piece A). */
  setZone(zone: {
    stations: readonly SignalStation[];
    harbors: readonly { x: number; z: number }[];
    sites?: readonly WorkSite[];
  }): void;
  setVolume(id: VolumeId, volume: number): void;
  setMuted(muted: boolean): void;
}

/** The on-foot frame without what the audio adds itself (the listener and its clock). */
export type FootSource = () => Omit<FootFrame, 'listener' | 'nowS'> | undefined;

/** What the combat audio reads each frame from the combat core and the targets. */
export interface CombatSource {
  shots(): readonly ShotView[];
  captains(): readonly { id: string; phase: string }[];
}

export interface GameAudioOptions {
  game: GameContext;
  target: Window;
  storage?: Storage | undefined;
  /** The lights with fog signals, placed in the zone. */
  stations?: readonly SignalStation[];
  /** Points in the harbors (pier roots), where the gulls gather. */
  harbors?: readonly { x: number; z: number }[];
  /** Where the harbors are heard at work (Phase 4 piece J). */
  sites?: readonly WorkSite[];
  /** The player's Wanted region now, for which tier falls get a stinger (piece H). */
  region?: () => string | undefined;
  /** Show captions for directional cues (Settings → Sound); on by default. */
  captions?: boolean;
  /** Each lock-state change, e.g. for a "click to enable sound" hint. */
  onState?: (state: AudioState) => void;
}

/** Undefined when the browser has no Web Audio; the game runs silent then. */
export async function createGameAudio(options: GameAudioOptions): Promise<GameAudio | undefined> {
  const { game, target, storage } = options;
  if (!('AudioContext' in target)) {
    options.onState?.('unavailable');
    return undefined;
  }
  const ctx = SharedAudioContext.getContext() as AudioContext;
  const settings = loadAudioSettings(storage);
  const mixer = new AudioMixer(ctx, settings);
  unlockAudio(ctx, target, options.onState);

  // Decoding works while the context is still locked, so this needn't wait for a click.
  const baseUrl = target.document.baseURI;
  const urlsOf = (bundle: string): Promise<ReadonlyMap<string, string>> =>
    soundUrls(bundle, baseUrl).catch((err: unknown) => {
      console.warn(`Music ${bundle} unavailable`, err);
      return new Map<string, string>();
    });
  const [bank, musicUrls, chartUrls] = await Promise.all([
    loadSoundBank(
      ctx,
      [
        SAILING_AUDIO_BUNDLE,
        WORLD_AUDIO_BUNDLE,
        CHART_AUDIO_BUNDLE,
        HARBOR_AUDIO_BUNDLE,
        PORT_AUDIO_BUNDLE,
        LAW_AUDIO_BUNDLE,
        COMBAT_AUDIO_BUNDLE,
        COMBAT_MUSIC_BUNDLE,
        FOOT_AUDIO_BUNDLE,
      ],
      baseUrl,
    ),
    urlsOf(MUSIC_BUNDLE),
    urlsOf(CHART_MUSIC_BUNDLE),
  ]);
  const sailing = new SailingSoundscape(mixer, bank);
  const world = new WorldSoundscape(mixer, bank, options.stations);
  const whistles = new ShipWhistles(mixer, bank);
  const captions = new CaptionFeed();
  captions.enabled = options.captions ?? true;
  world.captions = captions;
  whistles.captions = captions;
  const harbor = new HarborWorks(mixer, bank);
  harbor.setSites(options.sites ?? []);
  const trade = new TradeCues(mixer, bank);
  const law = new LawSounds(mixer, bank);
  law.captions = captions;
  const combat = new CombatSounds(mixer, bank);
  combat.captions = captions;
  const foot = new FootSounds(mixer, bank);
  foot.captions = captions;
  const records = new Map(SHIP_RECORDS.map((r) => [r.id, r]));
  const whistleShips: WhistleShip[] = [];
  const players: Partial<Record<Exclude<MusicMood, 'quiet'>, MusicPlayer>> = {};
  for (const [mood, id] of Object.entries(MUSIC_CUES) as [Exclude<MusicMood, 'quiet'>, string][]) {
    const url = musicUrls.get(id);
    if (url) players[mood] = createStreamPlayer(ctx, url, mixer.buses.music, target.document);
  }
  const music = new MusicDirector({ players });
  const chartUrl = chartUrls.get(CHART_MUSIC_CUE);
  const chartMusic = new ChartMusic(
    chartUrl
      ? createStreamPlayer(ctx, chartUrl, mixer.buses.music, target.document, true)
      : undefined,
  );
  const chartCues = new ChartCues(mixer, bank, chartMusic);
  law.chartStinger = (id, delay) => chartCues.stinger(id, delay);
  law.duckChart = (seconds) => chartMusic.duck(seconds);
  const running = (): boolean => ctx.state === 'running';
  game.events.on('EncounterSpotted', (e) => {
    if (running()) chartCues.stinger(stingerFor(e));
  });
  game.events.on('EncounterAvoided', ({ escaped }) => {
    if (running()) chartCues.stinger(escaped ? 'clear' : 'hunted');
  });

  game.events.on('TradeCompleted', ({ totalCents }) => {
    if (running()) trade.paid(totalCents);
  });
  game.events.on('StoresBought', ({ totalCents }) => {
    if (running()) trade.paid(totalCents);
  });
  game.events.on('PaperCried', ({ aboutYou }) => {
    if (running()) law.newsboy(aboutYou);
  });
  game.events.on('HarborMasterPaid', ({ cents }) => {
    if (running()) trade.paid(cents);
  });

  // The law (Phase 5 piece H).
  const lawShipViews: LawShipView[] = [];
  const lawShipId = (e: { id?: string }): LawShipId =>
    e.id === TUG_ID ? 'law.chartered_tug' : 'law.morrill';
  const lawShip = (by: string): LawShipView | undefined => lawShipViews.find((s) => s.id === by);
  game.events.on('WantedTierChanged', ({ region, from, to }) => {
    if (running()) law.tierChanged({ region, from, to });
  });
  game.events.on('Jailed', ({ execution }) => {
    if (running()) law.jailed(execution);
    else law.dropPending();
  });
  game.events.on('Released', () => {
    if (running()) law.released();
    else law.dropPending();
  });
  // Her ships are seen once a sailing frame. A hail, a gun or her bell that comes before the
  // first of those (the law can notice you the moment the arena is up, or the audio has only
  // just started) waits for it rather than going unheard.
  const lawWaiting: { by: string; play: (ship: LawShipView) => void }[] = [];
  const onLawShip = (by: string, play: (ship: LawShipView) => void): void => {
    if (!running()) return;
    const ship = lawShip(by);
    if (ship) play(ship);
    else lawWaiting.push({ by, play });
  };
  game.events.on('CutterHailed', (e) => onLawShip(e.by, (ship) => law.hailed(ship, e)));
  game.events.on('CutterFired', (e) => onLawShip(e.by, (ship) => law.fired(ship, e)));
  game.events.on('PursuitChanged', ({ pursued, by }) => {
    if (pursued) onLawShip(by, (ship) => law.pursuit(ship));
  });

  // Combat (Phase 6 piece G). The law's own guns stay with the law's sounds (piece H's
  // CutterFired), so nothing is heard twice.
  const defs = gameCombat();
  const kindOf = (weapon: string): GunKind => gunKindOf(weapon, defs.weapons.get(weapon)?.kind);
  const entityById = (id: string): Entity | undefined => {
    for (const e of game.world.with('npc', 'transform')) if (e.id === id) return e;
    return undefined;
  };
  const byLaw = (by: string): boolean => {
    const e = entityById(by);
    return e !== undefined && isLawShip(e);
  };
  game.events.on('WeaponFired', (e) => {
    if (!running() || byLaw(e.by)) return;
    combat.fired(
      { by: e.by, kind: kindOf(e.weapon), ammo: e.ammo, at: e.at, y: e.y, bearing: e.bearing },
      e.by === PLAYER_ID,
    );
  });
  // A ball into a ship: \`ShotLanded\` comes first, then any \`ShipHit\` with where it struck.
  const struckAt = new Map<string, string>();
  const atKey = (at: Vec3): string => `${at.x.toFixed(2)},${at.y.toFixed(2)},${at.z.toFixed(2)}`;
  game.events.on('ShipHit', (e) => {
    if (e.weapon !== 'boiler' && e.weapon !== 'dev') struckAt.set(atKey(e.at), e.location);
  });
  game.events.on('ShotLanded', (e) => {
    if (!running() || byLaw(e.by)) return;
    if (e.on === 'water') {
      combat.landed('water', e.ammo, e.at);
      return;
    }
    const key = atKey(e.at);
    queueMicrotask(() => {
      const location = struckAt.get(key) ?? 'hull';
      struckAt.delete(key);
      combat.landed(location === 'rigging' ? 'canvas' : 'wood', e.ammo, e.at);
    });
  });
  game.events.on('BoilerExploded', ({ at }) => {
    if (running()) combat.boiler(at);
  });
  game.events.on('MoraleBroken', ({ shipId }) => {
    const t = entityById(shipId)?.transform;
    if (t && running()) combat.struck({ x: t.position.x, z: t.position.z });
  });
  game.events.on('ShipGrappled', () => {
    if (running()) combat.grappled();
  });
  // Boarding: the outcome is raised right after the attempt, in the same call.
  let surrendered: string | undefined;
  let repelled: { shipId: string; killed: boolean } | undefined;
  game.events.on('ShipSurrendered', ({ shipId }) => {
    surrendered = shipId;
  });
  game.events.on('BoardingRepelled', ({ shipId, killed }) => {
    repelled = { shipId, killed };
  });
  game.events.on('BoardingAttempted', ({ shipId, option }) => {
    if (!running()) return;
    surrendered = undefined;
    repelled = undefined;
    queueMicrotask(() => {
      const won = surrendered === shipId;
      if (option === 'intimidate') combat.intimidated(won);
      else if (won || (repelled?.shipId === shipId && !repelled.killed)) combat.fight(won);
    });
  });
  let pursuedBy: string | undefined;
  game.events.on('PursuitChanged', ({ pursued, by }) => {
    pursuedBy = pursued ? by : pursuedBy === by ? undefined : pursuedBy;
  });
  let combatSource: CombatSource | undefined;
  let footSource: FootSource | undefined;
  const targetViews: { phase: string; distanceM: number }[] = [];

  const isPlayer = (shipId: string | undefined): boolean => {
    const player = game.world.with('playerControlled').first;
    return player !== undefined && shipId === player.id;
  };
  game.events.on('ShipTacked', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.tacked();
  });
  game.events.on('ShipJibed', ({ shipId, uncontrolled }) => {
    if (isPlayer(shipId)) sailing.jibed(uncontrolled);
  });
  const depthUnderPlayer = (): number => {
    const p = game.world.with('playerControlled', 'transform').first?.transform.position;
    return p ? (game.terrain?.depthAt(p.x, p.z) ?? 10) : 10;
  };
  game.events.on('AnchorDropped', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.anchorDropped(depthUnderPlayer());
  });
  game.events.on('AnchorWeighed', ({ shipId }) => {
    if (isPlayer(shipId)) sailing.anchorWeighed(depthUnderPlayer());
  });

  let active = false;
  let outside = false;
  let wasLoading = false;
  let mood: MusicMood = 'quiet';
  let nowS = 0;
  let listener: (() => ListenerPose) | undefined;
  let lastPose: ListenerPose | undefined;
  const towardShore = { x: 0, z: 0 };
  let harbors = options.harbors ?? [];
  const persist = (): void => saveAudioSettings(settings, storage);

  /** A frame on foot: the world's weather and signals from where you stand, then the foot. */
  const updateAshore = (
    f: Omit<FootFrame, 'listener' | 'nowS'>,
    frameSeconds: number,
    gameSeconds: number,
    shipHeading: number,
  ): void => {
    const at = f.player;
    const pose = listener?.() ?? {
      at: { x: at.x, y: at.y + 1.7, z: at.z },
      forward: { x: Math.sin(shipHeading), y: 0, z: -Math.cos(shipHeading) },
    };
    placeListener(ctx, pose.at, pose.forward);
    lastPose = pose;
    const terrain = game.terrain;
    if (terrain) terrain.shoreNormalAt(at.x, at.z, towardShore);
    let harborDistanceM = Infinity;
    for (const h of harbors) {
      harborDistanceM = Math.min(harborDistanceM, Math.hypot(h.x - at.x, h.z - at.z));
    }
    const fogVisibilityM = game.weather.fogVisibilityAt(gameSeconds);
    const storm01 = game.weather.stormAt(gameSeconds);
    // Under a roof the rain is on the shingles, not on you.
    const rain01 = f.rain01 * (f.inside ? 0.45 : 1);
    world.update(
      {
        listener: pose.at,
        ship: { x: at.x, z: at.z },
        nowS,
        windKn: f.windKn,
        rain01,
        storm01,
        fogVisibilityM,
        fogBanks: game.weather.fogBanks(gameSeconds),
        sunElevationDeg: f.sunElevationDeg,
        month0: f.month0,
        // On the shore itself: the lake breaks a few meters off, wherever you stand.
        shoreDistanceM: f.place === 'district' ? 30 : 15,
        towardShore: { x: -towardShore.x, z: -towardShore.z },
        harborDistanceM,
      },
      frameSeconds,
    );
    const { hour } = dayAndHour(gameSeconds);
    harbor.update(
      {
        listener: pose.at,
        hour,
        month0: f.month0,
        rain01,
        storm01,
        damping: fogMix(fogVisibilityM, f.windKn).damping,
      },
      frameSeconds,
    );
    foot.update({ ...f, listener: pose.at, nowS }, frameSeconds);
    mood = musicMood({
      sunElevationDeg: f.sunElevationDeg,
      fogVisibilityM,
      windKn: f.windKn,
      rain01,
      storm01,
    });
    // No open-water tune in town or with the watch stirring; it plays on a wild shore.
    music.update(
      frameSeconds,
      f.place === 'district' || foot.tense ? 'quiet' : mood,
      world.signalHeard,
    );
  };

  return {
    mixer,
    bank,
    sailing,
    world,
    whistles,
    music,
    chartMusic,
    chartCues,
    harbor,
    trade,
    law,
    combat,
    foot,
    captions,
    captionsNow() {
      if (!lastPose || !outside) return [];
      return captions.visible(nowS, lastPose.at, lastPose.forward);
    },
    portScreen(open) {
      if (!running()) return;
      if (open) trade.opened();
      else trade.closed();
    },
    get mood() {
      return mood;
    },
    update(frameSeconds, mode, loading = false) {
      nowS += frameSeconds;
      if (loading && !wasLoading && running()) chartCues.transition();
      wasLoading = loading;
      // The chart's theme while the chart is up; the fog fade hands over to the zone.
      chartMusic.update(frameSeconds, mode === 'chart' && !loading && running());
      law.flush(nowS, options.region?.(), game.state.jail != null);
      const player = game.world.with('playerControlled', 'transform', 'sailing').first;
      const sailingNow = mode === 'sailing' && player !== undefined;
      // Ashore (piece I): the weather, the gulls and the fog signals go on over you.
      const ashore = mode === 'onFoot' && player !== undefined ? footSource?.() : undefined;
      if (sailingNow !== active) {
        active = sailingNow;
        sailing.setActive(active);
        if (!active) {
          law.stop();
          combat.stop();
          lawShipViews.length = 0;
          lawWaiting.length = 0;
        }
      }
      const outsideNow = sailingNow || ashore !== undefined;
      if (outsideNow !== outside) {
        outside = outsideNow;
        world.setActive(outside);
        music.setActive(outside);
      }
      foot.setActive(ashore !== undefined);
      if (!player || !outsideNow || ctx.state !== 'running') return;

      const { state, cls } = player.sailing;
      const gameSeconds = game.state.environment.clock.gameSeconds;
      if (ashore) {
        updateAshore(ashore, frameSeconds, gameSeconds, state.heading);
        return;
      }
      const wind = game.weather.windAt({ x: state.x, z: state.z }, gameSeconds);
      sailing.update(
        {
          state,
          cls,
          transform: player.transform,
          headSeaM: headSeaAmplitude(
            game.sea.waves,
            state.heading,
            seaScaleAt(game.sea, state.x, state.z),
          ),
          gust01: wind.gust01,
          strain01: player.hazards?.state.strain,
        },
        frameSeconds,
      );

      const pose = listener?.() ?? {
        at: { x: state.x, y: 3, z: state.z },
        forward: { x: Math.sin(state.heading), y: 0, z: -Math.cos(state.heading) },
      };
      placeListener(ctx, pose.at, pose.forward);
      lastPose = pose;
      const terrain = game.terrain;
      if (terrain) terrain.shoreNormalAt(state.x, state.z, towardShore);
      let harborDistanceM = Infinity;
      for (const h of harbors) {
        harborDistanceM = Math.min(harborDistanceM, Math.hypot(h.x - state.x, h.z - state.z));
      }
      const sunElevationDeg = (sunAt(gameSeconds).elevationRad * 180) / Math.PI;
      const fogVisibilityM = game.weather.fogVisibilityAt(gameSeconds);
      const rain01 = game.weather.rainAt(gameSeconds);
      const storm01 = game.weather.stormAt(gameSeconds);
      world.update(
        {
          listener: pose.at,
          ship: { x: state.x, z: state.z },
          nowS,
          windKn: state.windKn,
          rain01,
          storm01,
          fogVisibilityM,
          fogBanks: game.weather.fogBanks(gameSeconds),
          sunElevationDeg,
          month0: calendarDate(gameSeconds).getUTCMonth(),
          shoreDistanceM: terrain?.contains(state.x, state.z)
            ? terrain.shoreDistanceAt(state.x, state.z)
            : 5000,
          // The shore normal points out to sea; the shore is the other way.
          towardShore: { x: -towardShore.x, z: -towardShore.z },
          harborDistanceM,
        },
        frameSeconds,
      );

      const { hour } = dayAndHour(gameSeconds);
      harbor.update(
        {
          listener: pose.at,
          hour,
          month0: calendarDate(gameSeconds).getUTCMonth(),
          rain01,
          storm01,
          damping: fogMix(fogVisibilityM, state.windKn).damping,
        },
        frameSeconds,
      );

      whistleShips.length = 0;
      for (const e of game.world.with('npc', 'transform')) {
        const record = records.get(e.npc.classId);
        if (!record?.whistle) continue;
        whistleShips.push({
          id: e.id ?? e.npc.classId,
          record,
          x: e.transform.position.x,
          z: e.transform.position.z,
          headingRad: e.transform.heading,
          speedKn: e.npc.speedKn,
        });
      }
      whistles.update(
        {
          listener: pose.at,
          player: { x: state.x, z: state.z, headingRad: state.heading },
          nowS,
          windFromRad: wind.fromRad,
          fogVisibilityM,
          fogBanks: game.weather.fogBanks(gameSeconds),
          damping: fogMix(fogVisibilityM, state.windKn).damping,
        },
        whistleShips,
      );

      lawShipViews.length = 0;
      for (const e of game.world.with('npc', 'transform')) {
        if (!isLawShip(e)) continue;
        lawShipViews.push({
          id: lawShipId(e),
          key: e.id ?? e.npc.classId,
          x: e.transform.position.x,
          z: e.transform.position.z,
          speedKn: e.npc.speedKn,
        });
      }
      law.update(
        {
          listener: pose.at,
          nowS,
          gameSeconds,
          damping: fogMix(fogVisibilityM, state.windKn).damping,
          ships: lawShipViews,
        },
        frameSeconds,
      );
      for (const w of lawWaiting.splice(0)) {
        const ship = lawShip(w.by);
        if (ship) w.play(ship);
      }

      targetViews.length = 0;
      for (const c of combatSource?.captains() ?? []) {
        const t = entityById(c.id)?.transform;
        if (!t) continue;
        targetViews.push({
          phase: c.phase,
          distanceM: Math.hypot(t.position.x - state.x, t.position.z - state.z),
        });
      }
      const chaser = pursuedBy ? lawShipViews.find((s) => s.id === pursuedBy) : undefined;
      combat.update(
        {
          listener: pose.at,
          nowS,
          damping: fogMix(fogVisibilityM, state.windKn).damping,
          shots: combatSource?.shots() ?? [],
          targets: targetViews,
          lawPursuitM: chaser
            ? Math.hypot(chaser.x - state.x, chaser.z - state.z)
            : pursuedBy
              ? Infinity
              : undefined,
        },
        frameSeconds,
      );

      mood = musicMood({ sunElevationDeg, fogVisibilityM, windKn: state.windKn, rain01, storm01 });
      // The chase layer takes over from the open-water music while it plays.
      music.update(
        frameSeconds,
        combat.chase > 0 ? 'quiet' : mood,
        world.signalHeard || whistles.heard || law.ducking,
      );
    },
    setListener(pose) {
      listener = pose;
    },
    setCombatSource(source) {
      combatSource = source;
    },
    setFootSource(source) {
      footSource = source;
    },
    setZone(zone) {
      world.setStations(zone.stations);
      harbors = zone.harbors;
      harbor.setSites(zone.sites ?? []);
      captions.clear();
    },
    setVolume(id, volume) {
      mixer.setVolume(id, volume);
      persist();
    },
    setMuted(muted) {
      mixer.setMuted(muted);
      persist();
    },
  };
}
