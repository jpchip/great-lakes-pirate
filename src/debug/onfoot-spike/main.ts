import { EventBus } from '../../core/events';
import { InputMapper } from '../../core/input';
import { createLoop, FixedStepper, GAMEPLAY_TICK_HZ } from '../../core/loop';
import { PointerLook } from '../../core/pointer-look';
import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import { createGameWorld } from '../../gameplay/ecs';
import { FollowCamera } from '../../gameplay/onfoot/camera';
import { DEFAULT_CONTROLLER } from '../../gameplay/onfoot/controller';
import type { GameContext, GameEvents } from '../../modes/context';
import { ModeMachine } from '../../modes/machine';
import { createOnFootMode } from '../../modes/on-foot';
import { createLocalWeather } from '../../sim/weather/local-weather';
import { createSea } from '../../sim/weather/waves';
import { createWorldState } from '../../sim/world-state';
import { createSpikeChunk } from './chunk';
import { createSpikeScene } from './scene';

/**
 * Spike S5 entry (dev only: `npm run dev`, then open /onfoot-spike.html). Its own page,
 * so it never touches the main game's boot or test scene.
 *
 * Query options: `?props=2000` adds stress props, `?hz=30` changes the tick rate.
 */

const params = new URLSearchParams(window.location.search);
const stressProps = Number(params.get('props') ?? 0);
const hz = Number(params.get('hz') ?? GAMEPLAY_TICK_HZ);

const container = document.getElementById('app');
const hud = document.getElementById('hud');
if (!container || !hud) throw new Error('Missing #app or #hud');

const chunk = createSpikeChunk('spike-s5', stressProps);
const state = createWorldState('spike-s5');
// Start at 21:00 so the clock readout shows R = 6 ticking toward a night heist.
state.environment.clock.gameSeconds = 21 * 3600;

const input = new InputMapper();
input.attach(window);
const ctx: GameContext = {
  state,
  world: createGameWorld(),
  rng: Rng.fromState(state.environment.rng),
  input,
  events: new EventBus<GameEvents>(),
  // Flat water on foot for now; the pier and shore don't follow waves yet.
  sea: createSea([]),
  weather: createLocalWeather(),
};

const camera = new FollowCamera();
const look = new PointerLook(container);
look.attach();

const mode = createOnFootMode(ctx, chunk, chunk.spawn, () => camera.yaw);
const scene = createSpikeScene(
  container,
  chunk,
  mode.character,
  mode.previous,
  camera,
  DEFAULT_CONTROLLER,
);

const machine = new ModeMachine();
machine.register(mode).transition('onFoot');
document.body.dataset['mode'] = 'onFoot';

// Rolling stats for the dev readout.
const stepSamples: number[] = [];
let frameMsAvg = 16;
let hudTimer = 0;

const loop = createLoop(
  {
    tick(dt) {
      machine.update(dt);
      input.endTick();
      stepSamples.push(mode.lastStepMs);
      if (stepSamples.length > 240) stepSamples.shift();
    },
    frame(alpha, frameSeconds) {
      const { dx, dy } = look.consume();
      camera.look(dx, dy);
      machine.render(alpha, frameSeconds);
      scene.render(alpha, frameSeconds);

      frameMsAvg += (frameSeconds * 1000 - frameMsAvg) * 0.05;
      hudTimer += frameSeconds;
      if (hudTimer < 0.25) return;
      hudTimer = 0;
      const c = mode.character;
      const avg = stepSamples.reduce((a, b) => a + b, 0) / Math.max(stepSamples.length, 1);
      const max = Math.max(0, ...stepSamples);
      const { hour } = dayAndHour(state.environment.clock.gameSeconds);
      const hh = Math.floor(hour);
      const mm = Math.floor((hour - hh) * 60);
      const info = scene.renderer.info.render;
      hud.textContent = [
        `S5 on-foot spike  ${look.locked ? '' : '(click to look)'}`,
        `WASD move · Shift run · C crouch · Space hop · Esc release mouse`,
        ``,
        `frame ${frameMsAvg.toFixed(1)} ms (${(1000 / frameMsAvg).toFixed(0)} fps) · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`,
        `controller ${avg.toFixed(3)} ms avg · ${max.toFixed(3)} ms max @ ${hz} Hz`,
        `colliders ${chunk.colliders.size} (+${chunk.stressProps} stress)`,
        ``,
        `${c.gait}${c.crouching ? ' (crouched)' : ''} · ${Math.hypot(c.velocity.x, c.velocity.z).toFixed(1)} m/s`,
        `pos ${c.position.x.toFixed(1)}, ${c.position.y.toFixed(2)}, ${c.position.z.toFixed(1)} · slope ${((c.groundSlope * 180) / Math.PI).toFixed(0)}°`,
        `clock ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} (R = 6)`,
      ].join('\n');
      document.body.dataset['gait'] = c.gait;
    },
  },
  new FixedStepper(hz),
);
loop.start();

// For poking at the controller from the console or a Playwright script.
Object.assign(window, { spike: { mode, camera, chunk, input } });
