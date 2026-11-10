import * as THREE from 'three';
import { allPortraits } from '../../sim/character/backgrounds';
import { Character, loadHumanoids } from '../../render/characters/humanoid';
import { CLIPS, type ClipName } from '../../render/characters/humanoid-spec';
import { lookFromPortrait, NPC_ROLES, npcLook, type Look } from '../../render/characters/looks';
import { OutlineSettings } from '../../render/style/outline';
import { StyleLighting } from '../../render/style/stylized-material';
import { directionFrom, TIMES_OF_DAY } from '../../render/style/time-of-day';

/**
 * The character lineup (dev only: `npm run dev`, then /characters.html), for judging the
 * look of Phase 7 piece B: every portrait preset as the player, then each NPC role.
 *
 *   ?set=players|npcs|all   which row (default all)
 *   ?clip=walk              play a clip (default idle); ?t=0.4 freezes it at that time
 *   ?tod=day|dusk|night     light (default day)
 *   ?dist=7&az=20&h=1.5     camera distance, azimuth (deg) and target height
 *   ?lod=2                  force a LOD; ?outline=0 hides the ink
 *   ?cycle=1                step through every clip, two seconds each
 */

const params = new URLSearchParams(window.location.search);
const set = params.get('set') ?? 'all';
const clipParam = params.get('clip') as ClipName | null;
const freeze = params.has('t') ? Number(params.get('t')) : null;
const tod = params.get('tod') ?? 'day';
const forcedLod = params.has('lod') ? Number(params.get('lod')) : null;
const cycle = params.get('cycle') === '1';

const container = document.getElementById('app');
const hud = document.getElementById('hud');
if (!container || !hud) throw new Error('Missing #app or #hud');
const app: HTMLElement = container;
const readout: HTMLElement = hud;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const lighting = new StyleLighting();
const outline = new OutlineSettings();
outline.setResolution(renderer);
const u = lighting.uniforms;
if (tod === 'day') {
  scene.background = new THREE.Color(0x9fb3c4);
  u.uKeyDirection.value.copy(directionFrom(200, 40));
  u.uKeyColor.value.set(0xfff1dc).multiplyScalar(1.1);
  u.uSkyAmbient.value.set(0xb8c6d6).multiplyScalar(0.75);
  u.uGroundAmbient.value.set(0x5a5040).multiplyScalar(0.75);
  u.uRimColor.value.set(0xffffff).multiplyScalar(0.15);
} else {
  const t = TIMES_OF_DAY[tod === 'night' ? 'night' : 'dusk'];
  scene.background = new THREE.Color(t.horizon);
  lighting.apply(t);
}

// A plank deck to stand on.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(60, 12),
  new THREE.MeshBasicMaterial({ color: tod === 'night' ? 0x2a2a2e : 0x8b7a60 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const looks: { label: string; look: Look }[] = [];
if (set !== 'npcs') {
  for (const p of allPortraits()) looks.push({ label: p.name, look: lookFromPortrait(p) });
}
if (set !== 'players') {
  for (const role of NPC_ROLES) looks.push({ label: role, look: npcLook(role, 3) });
}

const library = await loadHumanoids(new URL('./', document.baseURI).href);
const spacing = 1.15;
const characters: Character[] = [];
const labels: HTMLDivElement[] = [];
looks.forEach(({ label, look }, i) => {
  const character = new Character(library, look, { style: 'toon', lighting, outline });
  character.root.position.x = (i - (looks.length - 1) / 2) * spacing;
  // Face the camera (heading π faces +Z, toward the viewer).
  character.root.rotation.y = Math.PI;
  if (look.held === 'lantern' && tod !== 'day')
    character.setGlow(new THREE.Color(0xffc873).multiplyScalar(1.4));
  scene.add(character.root);
  characters.push(character);
  const div = document.createElement('div');
  div.className = 'label';
  div.textContent = label;
  document.body.appendChild(div);
  labels.push(div);
});

const width = looks.length * spacing;
const camera = new THREE.PerspectiveCamera(
  30,
  container.clientWidth / container.clientHeight,
  0.1,
  200,
);
const dist = Number(params.get('dist') ?? Math.max(5, width * 1.15));
const az = THREE.MathUtils.degToRad(Number(params.get('az') ?? 0));
const h = Number(params.get('h') ?? 1.0);
camera.position.set(Math.sin(az) * dist, h + dist * 0.08, Math.cos(az) * dist);
camera.lookAt(0, h, 0);

const clipNames = Object.keys(CLIPS) as ClipName[];
let clipIndex = Math.max(0, clipNames.indexOf(clipParam ?? 'idle'));
function playAll(name: ClipName): void {
  for (const c of characters) c.play(name, 0);
}
playAll(clipNames[clipIndex] ?? 'idle');

const clock = new THREE.Clock();
let cycleTime = 0;
const projected = new THREE.Vector3();
function frame(): void {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (cycle) {
    cycleTime += dt;
    if (cycleTime > 2) {
      cycleTime = 0;
      clipIndex = (clipIndex + 1) % clipNames.length;
      playAll(clipNames[clipIndex] ?? 'idle');
    }
  }
  characters.forEach((c, i) => {
    const d = camera.position.distanceTo(c.root.position);
    if (freeze !== null) {
      c.mixer.setTime(freeze);
      c.setLod(forcedLod ?? 0);
    } else {
      c.update(dt, forcedLod !== null ? ([7, 20, 50][forcedLod] ?? d) : d);
    }
    if (c.outline) c.outline.visible = params.get('outline') !== '0' && c.currentLod < 2;
    projected.copy(c.root.position).setY(-0.05).project(camera);
    const label = labels[i];
    if (label) {
      label.style.left = `${((projected.x + 1) / 2) * app.clientWidth}px`;
      label.style.top = `${((1 - projected.y) / 2) * app.clientHeight + 4}px`;
    }
  });
  renderer.render(scene, camera);
  const lod = characters[0]?.currentLod ?? 0;
  const tris = library.triangles(looks[0]?.look ?? npcLook('sailor', 1), lod);
  readout.textContent = `clip ${clipNames[clipIndex]}  lod ${lod}  ${tris} tris (first look)\ndraw calls ${renderer.info.render.calls}  triangles ${renderer.info.render.triangles}`;
  requestAnimationFrame(frame);
}
frame();
(window as unknown as { __glpCharacters: unknown }).__glpCharacters = {
  characters,
  library,
  ready: true,
};
