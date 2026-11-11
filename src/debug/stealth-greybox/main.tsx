import { render } from 'preact';
import { EventBus } from '../../core/events';
import { InputMapper } from '../../core/input';
import { createLoop, FixedStepper, GAMEPLAY_TICK_HZ } from '../../core/loop';
import { PointerLook } from '../../core/pointer-look';
import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import { createGameWorld } from '../../gameplay/ecs';
import { attachLaw } from '../../gameplay/law';
import { FollowCamera } from '../../gameplay/onfoot/camera';
import {
  conduct as judge,
  isNight,
  rectConductMap,
  type Conduct,
} from '../../gameplay/onfoot/conduct';
import { createFootLaw, type FootLaw } from '../../gameplay/onfoot/foot-law';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import { gameNpcs, rosterForTier } from '../../gameplay/onfoot/guards';
import { ambientLight01, type Lamp } from '../../gameplay/onfoot/light';
import { fogOnFoot01 } from '../../gameplay/onfoot/perception';
import {
  createStealth,
  type Stealth,
  type StealthEvent,
  type StealthInputs,
} from '../../gameplay/onfoot/stealth';
import type { GameContext, GameEvents } from '../../modes/context';
import { ModeMachine } from '../../modes/machine';
import {
  createTools,
  guardNoun,
  type OnFootTools,
  type ToolEvent,
} from '../../gameplay/onfoot/tools';
import { createOnFootMode } from '../../modes/on-foot';
import { heatIn } from '../../sim/law/law';
import { regionOfPort } from '../../sim/law/regions';
import type { LawEvent } from '../../sim/law/law';
import type { SkyLight } from '../../sim/law/perception';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import { createLocalWeather } from '../../sim/weather/local-weather';
import { createSea } from '../../sim/weather/waves';
import { createWorldState } from '../../sim/world-state';
import { FootTools } from '../../ui/hud/FootTools';
import { footToolsHud } from '../../ui/hud/foot-tools-model';
import { StealthHud } from '../../ui/hud/StealthHud';
import { stealthHud } from '../../ui/hud/stealth-model';
import '../../ui/theme.css';
import { createGreyboxDistrict } from './district';
import { createGreyboxView } from './view';

/**
 * Phase 7 pieces D and E's greybox (dev only: `npm run dev`, then /stealth-greybox.html):
 * the perception, the guards, conduct and the tools in a docks district of plain boxes,
 * with the stealth HUD and the tool belt, until Bayfield on foot has them all.
 *
 * Query options: `?moon=full|new|sky` (default full), `?fog=<meters>` (default clear),
 * `?rain=0..1`, `?tier=0..5`, `?hour=<0–24>` (default 23), `?fame=0..1`, `?cones=0`.
 * Keys: 1–5 the tool belt (cosh, rope, knife, whiskey, bribe), F use it (hold to tie a man
 * up), or pick up and put down a man who's down.
 * Dev keys: N moon, G fog, T tier, H an hour on, L your lantern, R throw a stone ahead,
 * V sight cones, P restock the belt.
 */

const params = new URLSearchParams(window.location.search);
let moonMode = params.get('moon') ?? 'full';
let fogM = Number(params.get('fog') ?? 20000);
const rain01 = Number(params.get('rain') ?? 0);
let tier = Number(params.get('tier') ?? 0);
const fame01 = Number(params.get('fame') ?? 0.25);

const container = document.getElementById('app');
const hud = document.getElementById('hud');
const hudRoot = document.getElementById('ui');
if (!container || !hud || !hudRoot) throw new Error('Missing #app, #hud or #ui');

const district = createGreyboxDistrict();
const state = createWorldState('stealth-greybox');
state.environment.clock.gameSeconds = Number(params.get('hour') ?? 23) * 3600 + 10 * 86400;
const restock = (): void => {
  state.player.purse = Math.max(state.player.purse, 5000);
  state.player.stores['store.cosh'] = 1;
  state.player.stores['store.rope'] = 2;
  state.player.stores['store.whiskey'] = 3;
};
restock();
// The greybox's yards and the moored ship are private (piece E's conduct).
const conductMap = rectConductMap(
  district.restricted.map((rect, i) => ({ id: `greybox.private${i}`, kind: 'private', rect })),
);
const region = regionOfPort('port.bayfield') ?? 'region.apostles';

const input = new InputMapper();
input.attach(window);
const ctx: GameContext = {
  state,
  world: createGameWorld(),
  rng: Rng.fromState(state.environment.rng),
  input,
  events: new EventBus<GameEvents>(),
  sea: createSea([]),
  weather: createLocalWeather(),
};

const camera = new FollowCamera();
const look = new PointerLook(container);
look.attach();
const mode = createOnFootMode(ctx, district, district.spawn, () => camera.yaw);
const view = createGreyboxView(
  container,
  district,
  mode.character,
  mode.previous,
  camera,
  DEFAULT_CONTROLLER,
);
view.showCones = params.get('cones') !== '0';

const law = attachLaw(ctx, 'stealth-greybox');

const machine = new ModeMachine();
machine.register(mode).transition('onFoot');
document.body.dataset['mode'] = 'onFoot';

const playerLantern: Lamp = { x: 0, y: 0, z: 0, radiusM: 6, intensity: 0.8, lit: false };
const log: string[] = [];
const describe = (e: StealthEvent): string | undefined => {
  switch (e.type) {
    case 'NpcStateChanged':
      return `${e.npc}: ${e.from} → ${e.to}`;
    case 'PlayerSpotted':
      return `${e.npc} has seen you${e.identified ? ' and knows your face' : ''}`;
    case 'PlayerIdentified':
      return `${e.npc} knows your face`;
    case 'GuardReported':
      return `${e.npc} reported you (${e.why})${e.identified ? ', by name' : ''}`;
    case 'BodyFound':
      return `${e.finder} found ${e.npc} ${e.dead ? 'dead' : e.drunk ? 'asleep drunk' : 'out cold'}`;
    case 'Captured':
      return `Taken by ${e.npc}`;
    case 'GuardWoke':
      return `${e.npc} came round${e.drank ? ', sheepish' : ''}`;
    case 'NoiseMade':
      return e.noise.kind === 'footstep' ? undefined : `${e.noise.kind} (${e.noise.radiusM} m)`;
  }
};

const describeTool = (e: ToolEvent): string => {
  const who = (id: string) => {
    const g = stealth.guard(id);
    return g ? guardNoun(g) : id;
  };
  switch (e.type) {
    case 'KnockedOut':
      return `You knocked out ${who(e.npc)}${e.seenBy.length ? ` (seen by ${e.seenBy.join(', ')})` : ''}`;
    case 'Killed':
      return `You killed ${who(e.npc)}${e.seenBy.length ? ` (seen by ${e.seenBy.join(', ')})` : ''}`;
    case 'Bound':
      return `You tied up ${who(e.npc)}`;
    case 'BribePaid':
      return `${who(e.npc)} took $${(e.cents / 100).toFixed(2)} and looks away`;
    case 'BribeRefused':
      return `${who(e.npc)} won't take your money${e.reports ? ' and will report it' : ''}`;
    case 'WhiskeyTaken':
      return `${who(e.npc)} took a long pull`;
    case 'WhiskeyRefused':
      return `${who(e.npc)} won't drink on duty`;
    case 'BodyLifted':
      return `You picked up ${who(e.npc)}`;
    case 'BodyDropped':
      return e.sunk
        ? `${who(e.npc)} went into the lake${e.drowned ? ' and drowned' : ''}`
        : `You put ${who(e.npc)} down`;
  }
};
const describeLaw = (e: LawEvent): string | undefined => {
  switch (e.type) {
    case 'CrimeCommitted':
      return `LAW: ${e.crime} (${e.witnesses} witness${e.witnesses === 1 ? '' : 'es'})`;
    case 'ReportFiled':
      return `LAW: ${e.witness.name} reported ${e.crime} (${e.identification}) +${e.heatAdded.toFixed(0)} heat`;
    case 'Witnessed':
      return `LAW: ${e.witness.name} will report (${e.identification})`;
    default:
      return undefined;
  }
};
const say = (line: string | undefined): void => {
  if (!line) return;
  log.unshift(line);
  log.length = Math.min(log.length, 10);
};

let stealth: Stealth;
let tools: OnFootTools;
let footLaw: FootLaw | undefined;
let lastConduct: Conduct | undefined;
const build = (): void => {
  const defs = gameNpcs();
  stealth = createStealth(
    {
      zone: district,
      nav: district.nav,
      lamps: district.lamps,
      rng: Rng.fromSeed(`stealth-greybox-${tier}`),
      lawPost: district.lawPost,
    },
    defs,
    rosterForTier(defs, district.guards, district.spareBeats, tier),
    tier,
  );
  stealth.on((e) => say(describe(e)));
  tools = createTools(
    stealth,
    state.player,
    district,
    Rng.fromSeed(`stealth-greybox-tools-${tier}`),
  );
  tools.on((e) => say(describeTool(e)));
  footLaw?.dispose();
  footLaw = createFootLaw(
    stealth,
    tools,
    law,
    { region, port: 'port.bayfield' },
    () => lastConduct?.reason,
  );
  view.setGuards(stealth.guards);
};
for (const type of ['CrimeCommitted', 'Witnessed', 'ReportFiled'] as const) {
  ctx.events.on(type, (payload) => say(describeLaw({ type, ...payload } as LawEvent)));
}
build();

const sky = (): SkyLight => {
  const now = state.environment.clock.gameSeconds;
  const sun = sunAt(now);
  const moon = moonAt(now);
  if (moonMode === 'sky') {
    return {
      sunElevationRad: sun.elevationRad,
      moonElevationRad: moon.elevationRad,
      moonIllumination01: moon.illumination01,
      cloud01: 0,
    };
  }
  return {
    sunElevationRad: sun.elevationRad,
    moonElevationRad: 0.8,
    moonIllumination01: moonMode === 'full' ? 1 : 0,
    cloud01: 0,
  };
};

const conductNow = (): Conduct => {
  const c = mode.character;
  const { hour } = dayAndHour(state.environment.clock.gameSeconds);
  lastConduct = judge(conductMap, {
    at: c.position,
    gait: c.gait,
    crouching: c.crouching,
    swimming: c.swimming,
    hour,
    night: isNight(sky()),
    carryingBody: tools.carrying !== undefined,
    armed: tools.armed(),
  });
  return lastConduct;
};

const toolContext = () => ({
  player: mode.character,
  gameSeconds: state.environment.clock.gameSeconds,
  wantedTier: tier,
  fame01,
  light01: stealth.readout().light.level01,
});

const inputs = (): StealthInputs => {
  const p = mode.character.position;
  return {
    player: mode.character,
    playerParams: DEFAULT_CONTROLLER,
    surface: district.surfaceAt(p.x, p.z, p.y),
    playerLantern,
    sky: sky(),
    fogM,
    rain01,
    gameSeconds: state.environment.clock.gameSeconds,
    carrying: tools.carrying !== undefined,
    suspect: conductNow().suspect,
    fame01,
    wantedTier: tier,
  };
};

/** F held: seconds, for a tool that's held (rope). */
let holdS = -1;

window.addEventListener('keyup', (e) => {
  if (e.code === 'KeyF') holdS = -1;
});

window.addEventListener('keydown', (e) => {
  if (e.code.startsWith('Digit')) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= 9) tools.selectSlot(n - 1);
    return;
  }
  switch (e.code) {
    case 'KeyF': {
      if (e.repeat || stealth.captured) break;
      const o = tools.offer(toolContext());
      if (!o) break;
      if (o.holdS > 0) holdS = 0;
      else tools.use(toolContext());
      break;
    }
    case 'KeyP':
      restock();
      break;
    case 'KeyN':
      moonMode = moonMode === 'full' ? 'new' : moonMode === 'new' ? 'sky' : 'full';
      break;
    case 'KeyG':
      fogM = fogM > 1000 ? 120 : 20000;
      break;
    case 'KeyT':
      tier = (tier + 1) % 6;
      build();
      break;
    case 'KeyH':
      state.environment.clock.gameSeconds += 3600;
      break;
    case 'KeyL':
      playerLantern.lit = !playerLantern.lit;
      break;
    case 'KeyV':
      view.showCones = !view.showCones;
      break;
    case 'KeyR': {
      const c = mode.character;
      const h = camera.yaw;
      stealth.noiseAt('distraction', {
        x: c.position.x + Math.sin(h) * 10,
        y: c.position.y,
        z: c.position.z - Math.cos(h) * 10,
      });
      break;
    }
  }
});

let hudTimer = 0;
const loop = createLoop(
  {
    tick(dt) {
      if (!stealth.captured) machine.update(dt);
      input.endTick();
      const p = mode.character.position;
      playerLantern.x = p.x;
      playerLantern.y = p.y + 1.0;
      playerLantern.z = p.z;
      stealth.step(dt, inputs());
      if (holdS >= 0) {
        const o = tools.offer(toolContext());
        if (!o || !o.ok || o.holdS <= 0) holdS = -1;
        else if ((holdS += dt) >= o.holdS) {
          tools.use(toolContext());
          holdS = -1;
        }
      }
      tools.step(toolContext());
    },
    frame(alpha, frameSeconds) {
      const { dx, dy } = look.consume();
      camera.look(dx, dy);
      const s = sky();
      view.setNight(ambientLight01(s, fogOnFoot01(fogM)), fogM);
      machine.render(alpha, frameSeconds);
      view.render(alpha, frameSeconds, playerLantern);

      hudTimer += frameSeconds;
      if (hudTimer < 1 / 15) return;
      hudTimer = 0;
      const readout = stealth.readout();
      const now = state.environment.clock.gameSeconds;
      const snapshot = stealthHud(
        readout,
        mode.character.position,
        (q) => view.project(q),
        view.size(),
        now,
      );
      const offer = tools.offer(toolContext());
      const toolsHud = footToolsHud(
        tools,
        lastConduct ?? conductNow(),
        offer,
        offer && offer.holdS > 0 && holdS >= 0 ? holdS / offer.holdS : 0,
        state.player.purse,
      );
      render(
        <>
          <StealthHud hud={snapshot} />
          <FootTools hud={toolsHud} />
        </>,
        hudRoot,
      );
      document.body.dataset['conduct'] = lastConduct?.reason ?? 'none';
      document.body.dataset['gem'] = snapshot.gem.level;
      document.body.dataset['danger'] = snapshot.danger;
      document.body.dataset['captured'] = String(readout.captured);

      const { hour } = dayAndHour(now);
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const info = view.renderer.info.render;
      hud.textContent = [
        `Phase 7 pieces D–E: guards, conduct and tools (greybox)  ${look.locked ? '' : '(click to look)'}`,
        `WASD · Shift run · C crouch · Space hop · 1–5 tool belt · F use (hold to tie)`,
        `N moon (${moonMode}) · G fog (${fogM > 1000 ? 'clear' : `${fogM} m`}) · T tier (${tier}) · H +1 h · L lantern (${playerLantern.lit ? 'lit' : 'dark'})`,
        `R throw a stone · V cones · P restock the belt · heat in ${region}: ${heatIn(state, region).toFixed(0)}`,
        ``,
        `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · light ${readout.light.level01.toFixed(2)} (sky ${readout.light.ambient01.toFixed(2)}) · exposure ${readout.exposure01.toFixed(2)} · noise ${readout.noiseM.toFixed(1)} m`,
        `perception ${stealth.lastStepMs.toFixed(3)} ms · ${stealth.guards.length} guards · ${info.calls} calls`,
        ``,
        ...stealth.guards.map(
          (g) =>
            `${g.id.padEnd(22)} ${g.state.padEnd(11)} ${'█'.repeat(Math.round(g.meter * 10)).padEnd(10, '·')}${g.identified ? ' knows you' : ''}`,
        ),
        ``,
        ...log,
        readout.captured ? `\nCAPTURED: to Phase 5's jail (reload to try again)` : '',
      ].join('\n');
    },
  },
  new FixedStepper(GAMEPLAY_TICK_HZ),
);
loop.start();

// For Playwright and the console.
Object.assign(window, {
  greybox: {
    mode,
    camera,
    district,
    get stealth() {
      return stealth;
    },
    get tools() {
      return tools;
    },
    get footLaw() {
      return footLaw;
    },
    state,
    law,
    toolContext,
    setMoon(m: string) {
      moonMode = m;
    },
    setFog(m: number) {
      fogM = m;
    },
    setTier(t: number) {
      tier = t;
      build();
    },
  },
});
