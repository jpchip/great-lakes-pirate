import { render } from 'preact';
import { EventBus } from '../../core/events';
import { InputMapper } from '../../core/input';
import { createLoop, FixedStepper, GAMEPLAY_TICK_HZ } from '../../core/loop';
import { PointerLook } from '../../core/pointer-look';
import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import { createGameWorld } from '../../gameplay/ecs';
import { FollowCamera } from '../../gameplay/onfoot/camera';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import { gameNpcs, rosterForTier } from '../../gameplay/onfoot/guards';
import { ambientLight01, type Lamp } from '../../gameplay/onfoot/light';
import { fogOnFoot01 } from '../../gameplay/onfoot/perception';
import {
  createStealth,
  isDown,
  type Stealth,
  type StealthEvent,
  type StealthInputs,
} from '../../gameplay/onfoot/stealth';
import type { GameContext, GameEvents } from '../../modes/context';
import { ModeMachine } from '../../modes/machine';
import { createOnFootMode } from '../../modes/on-foot';
import type { SkyLight } from '../../sim/law/perception';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import { createLocalWeather } from '../../sim/weather/local-weather';
import { createSea } from '../../sim/weather/waves';
import { createWorldState } from '../../sim/world-state';
import { StealthHud } from '../../ui/hud/StealthHud';
import { stealthHud } from '../../ui/hud/stealth-model';
import '../../ui/theme.css';
import { createGreyboxDistrict, inRestricted } from './district';
import { createGreyboxView } from './view';

/**
 * Phase 7 piece D's greybox (dev only: `npm run dev`, then /stealth-greybox.html): the
 * perception and the guards in a docks district of plain boxes, with the stealth HUD, until
 * piece A wires on-foot into the game and piece C builds Bayfield.
 *
 * Query options: `?moon=full|new|sky` (default full), `?fog=<meters>` (default clear),
 * `?rain=0..1`, `?tier=0..5`, `?hour=<0–24>` (default 23), `?fame=0..1`, `?cones=0`.
 * Dev keys: N moon, G fog, T tier, H an hour on, L your lantern, R throw a stone ahead,
 * K knock out / X kill / B bribe / J give whiskey to the nearest guard, V sight cones.
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
      return `${e.finder} found ${e.npc} ${e.dead ? 'dead' : 'out cold'}`;
    case 'GuardWoke':
      return `${e.npc} came round`;
    case 'Captured':
      return `Taken by ${e.npc}`;
    case 'NoiseMade':
      return e.noise.kind === 'footstep' ? undefined : `${e.noise.kind} (${e.noise.radiusM} m)`;
  }
};

let stealth: Stealth;
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
  stealth.on((e) => {
    const line = describe(e);
    if (!line) return;
    log.unshift(line);
    log.length = Math.min(log.length, 8);
  });
  view.setGuards(stealth.guards);
};
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
    // Piece E owns conduct; here: in the yard, on the ship, skulking or running about.
    suspect: inRestricted(district, p) || mode.character.crouching || mode.character.gait === 'run',
    fame01,
    wantedTier: tier,
  };
};

const nearestGuard = () => {
  const p = mode.character.position;
  let best: (typeof stealth.guards)[number] | undefined;
  let bestD = Infinity;
  for (const g of stealth.guards) {
    if (isDown(g.state)) continue;
    const d = Math.hypot(g.body.position.x - p.x, g.body.position.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
};

window.addEventListener('keydown', (e) => {
  const now = state.environment.clock.gameSeconds;
  const g = nearestGuard();
  switch (e.code) {
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
    case 'KeyK':
      if (g) stealth.knockOut(g.id, now);
      break;
    case 'KeyX':
      if (g) stealth.kill(g.id);
      break;
    case 'KeyB':
      if (g) stealth.bribe(g.id, now + 2 * 3600);
      break;
    case 'KeyJ':
      if (g) stealth.makeDrunk(g.id, now, 1800);
      break;
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
      render(<StealthHud hud={snapshot} />, hudRoot);
      document.body.dataset['gem'] = snapshot.gem.level;
      document.body.dataset['danger'] = snapshot.danger;
      document.body.dataset['captured'] = String(readout.captured);

      const { hour } = dayAndHour(now);
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const info = view.renderer.info.render;
      hud.textContent = [
        `Phase 7 piece D: perception and guards (greybox)  ${look.locked ? '' : '(click to look)'}`,
        `WASD · Shift run · C crouch · Space hop`,
        `N moon (${moonMode}) · G fog (${fogM > 1000 ? 'clear' : `${fogM} m`}) · T tier (${tier}) · H +1 h · L lantern (${playerLantern.lit ? 'lit' : 'dark'})`,
        `R throw a stone · nearest guard: K knock out, X kill, B bribe, J whiskey · V cones`,
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
