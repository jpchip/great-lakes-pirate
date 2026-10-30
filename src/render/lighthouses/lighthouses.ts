import * as THREE from 'three';
import type { ZoneFrame } from '../../core/coords';
import {
  LIGHT_TIERS,
  LIGHTHOUSES,
  beamBearing,
  flashSeen,
  lampHex,
  lampLevel,
  lightRangeM,
  placeLights,
  type LightTerrain,
  type PlacedLight,
} from '../../sim/lighthouses';
import type { QualityPreset } from '../quality';
import { PALETTE } from '../style/palette';
import { addOutlines, creaseNormals, type OutlineSettings } from '../style/outline';
import {
  createStylizedMaterial,
  type StyleLighting,
  type StylizedMaterial,
} from '../style/stylized-material';
import { buildStation } from './kit';

/**
 * The lights of the Apostles drawn (plan 14 §8, §10; Phase 2 piece F): each station from
 * the kit with its lantern glowing from dusk to dawn, a glare where the lamp is, a beam
 * cone that sweeps for the flashing lights (Raspberry and Outer Island), and one real lamp
 * on the nearby ground, through the style lighting's local lamp, for whichever light the
 * ship is closest to.
 *
 * Per light: three draws for the station (body, lantern and windows), one for the glare
 * and one for the beam, so seven lights cost at most about 35 calls, fewer by culling.
 * Past the station's draw distance only the glare and beam remain, so a lit light shows
 * across the zone and a dark one is just a silhouette.
 */

/** Stations draw out to here; past it the fog has taken them. */
const STATION_FAR_M = 9000;
/** The nearest light lights the ground within this, meters. */
const LAMP_REACH_M = 260;
/** Lamp glow toward the eye is dimmed by fog at this share of the scene fog's density. */
const LAMP_FOG_SHARE = 0.55;

const beamVertex = /* glsl */ `
uniform float uLength;
varying float vAlong;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vOutside;
void main() {
  // Seen from inside the cone, its far wall would wash over the whole screen with a hard
  // edge. Fade the cone out as the eye nears its axis; the glare carries the flash.
  vec3 apex = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  float cosToEye = dot(axis, normalize(cameraPosition - apex));
  vOutside = 1.0 - smoothstep(0.985, 0.997, cosToEye);
  vAlong = clamp(position.y / uLength, 0.0, 1.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uScatter;
uniform float uExtinction;
varying float vAlong;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vOutside;
void main() {
  vec3 toCamera = cameraPosition - vWorldPos;
  float distance = length(toCamera);
  // Soft edges: the cone wall seen edge-on is the beam's rim, seen face-on its core.
  float core = pow(abs(dot(normalize(vWorldNormal), toCamera / distance)), 1.6);
  float fade = pow(1.0 - vAlong, 2.2) * smoothstep(0.0, 0.015, vAlong);
  float transmit = exp(-uExtinction * distance);
  float a = uIntensity * uScatter * core * fade * transmit * vOutside;
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface BeamUniforms {
  [name: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uIntensity: THREE.IUniform<number>;
  uScatter: THREE.IUniform<number>;
  uExtinction: THREE.IUniform<number>;
  uLength: THREE.IUniform<number>;
}

function beamMaterial(color: THREE.Color, length: number): THREE.ShaderMaterial {
  const uniforms: BeamUniforms = {
    uColor: { value: color },
    uIntensity: { value: 0 },
    uScatter: { value: 0.5 },
    uExtinction: { value: 1 / 4000 },
    uLength: { value: length },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.name = 'lighthouse-beam';
  return material;
}

/** A soft round glow, built without a canvas. */
function glareTexture(): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const r = Math.hypot((i + 0.5) / size - 0.5, (j + 0.5) / size - 0.5) * 2;
      const core = Math.max(0, 1 - r / 0.2) ** 1;
      const halo = Math.max(0, 1 - r) ** 2.2 * 0.8;
      const a = Math.min(1, core + halo);
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface LightState {
  /** The light's id, as in data/lighthouses.json. */
  id: string;
  name: string;
  /** Meters from the camera to the lamp. */
  distanceM: number;
  /** Lamp level 0–1 (sunset to sunrise, times the tier's strength). */
  level: number;
  flashing: boolean;
}

export interface LighthouseView {
  readonly group: THREE.Group;
  readonly placed: readonly PlacedLight[];
  /** Lights lit this frame and the nearest one, for the debug readout. */
  readonly lit: number;
  readonly nearest: LightState | undefined;
  /** Draw calls the lights cost this frame. */
  readonly drawn: number;
  applyPreset(preset: QualityPreset): void;
  /**
   * `nowS` real seconds (the flashing lights' clock), `sunElevationDeg` from the
   * environment, `fogDensity` the scene's exp² density.
   */
  update(nowS: number, camera: THREE.Vector3, sunElevationDeg: number, fogDensity: number): void;
  dispose(): void;
}

interface Station {
  placed: PlacedLight;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  lantern: StylizedMaterial;
  windows: StylizedMaterial | undefined;
  glare: THREE.Sprite;
  beam: THREE.Mesh | undefined;
  beamMaterial: THREE.ShaderMaterial | undefined;
  beamPivot: THREE.Group | undefined;
  lamp: THREE.Vector3;
  color: THREE.Color;
  rangeM: number;
  strength: number;
  /** Red lamps are dim in linear light; this lifts them to read as bright as white ones. */
  gain: number;
}

export function createLighthouses(
  frame: ZoneFrame,
  terrain: LightTerrain,
  lighting: StyleLighting,
  outlines: OutlineSettings,
  preset: QualityPreset,
): LighthouseView {
  const group = new THREE.Group();
  group.name = 'lighthouses';
  const placed = placeLights(LIGHTHOUSES, frame, terrain);
  const texture = glareTexture();
  const stations: Station[] = [];
  let beams = preset.lighthouseBeams;

  for (const p of placed) {
    const def = p.def;
    const parts = buildStation(def);
    const root = new THREE.Group();
    root.name = def.id;
    root.position.set(p.x, p.groundM, p.z);
    // The sea is toward -z in the kit; three.js yaw is counter-clockwise.
    root.rotation.y = -p.seaward;

    const bodyMaterial = createStylizedMaterial('toon', lighting, { vertexColors: true });
    const lanternMaterial = createStylizedMaterial('toon', lighting, { vertexColors: true });
    const windowMaterial = parts.windows
      ? createStylizedMaterial('toon', lighting, { vertexColors: true })
      : undefined;
    const body = new THREE.Mesh(parts.body, bodyMaterial);
    body.name = 'body';
    const lantern = new THREE.Mesh(parts.lantern, lanternMaterial);
    lantern.name = 'lantern';
    lantern.userData['noOutline'] = true;
    const meshes = [body, lantern];
    root.add(body, lantern);
    if (parts.windows && windowMaterial) {
      const windows = new THREE.Mesh(parts.windows, windowMaterial);
      windows.name = 'windows';
      windows.userData['noOutline'] = true;
      meshes.push(windows);
      root.add(windows);
    }
    creaseNormals(root);
    // Ink outlines: lighthouses are hero objects (plan 14 §3.4), terrain is not.
    addOutlines(root, outlines);

    const color = new THREE.Color(lampHex(def.characteristic));
    const tier = LIGHT_TIERS[def.tier];
    const lamp = new THREE.Vector3(p.x, p.groundM + parts.lampY, p.z);

    const glare = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        fog: false,
        toneMapped: false,
      }),
    );
    glare.position.copy(lamp);
    glare.renderOrder = 3;
    glare.visible = false;
    group.add(glare);

    let beam: THREE.Mesh | undefined;
    let material: THREE.ShaderMaterial | undefined;
    let pivot: THREE.Group | undefined;
    if (def.characteristic.kind === 'flashing') {
      const length = tier.rangeM * 0.5;
      material = beamMaterial(color.clone(), length);
      const cone = new THREE.CylinderGeometry(length * 0.05, 0.4, length, 24, 1, true);
      cone.translate(0, length / 2, 0); // apex at the lamp
      beam = new THREE.Mesh(cone, material);
      beam.rotation.set(-Math.PI / 2 - 0.02, 0, 0); // horizontal toward -z, tipped slightly down
      beam.frustumCulled = false;
      beam.renderOrder = 2;
      pivot = new THREE.Group();
      pivot.position.copy(lamp);
      pivot.add(beam);
      group.add(pivot);
    }

    group.add(root);
    stations.push({
      placed: p,
      group: root,
      meshes,
      lantern: lanternMaterial,
      windows: windowMaterial,
      glare,
      beam,
      beamMaterial: material,
      beamPivot: pivot,
      lamp,
      color,
      rangeM: lightRangeM(def),
      strength: tier.strength,
      gain: def.characteristic.color === 'red' ? 2 : 1,
    });
  }

  let lit = 0;
  let drawn = 0;
  let nearest: LightState | undefined;
  const lampColor = new THREE.Color();
  const glow = new THREE.Color();
  const windowGlow = new THREE.Color(PALETTE.windowAmber);

  return {
    group,
    placed,
    get lit() {
      return lit;
    },
    get nearest() {
      return nearest;
    },
    get drawn() {
      return drawn;
    },
    applyPreset(next) {
      beams = next.lighthouseBeams;
    },
    update(nowS, camera, sunElevationDeg, fogDensity) {
      const dusk = lampLevel(sunElevationDeg);
      lit = 0;
      drawn = 0;
      nearest = undefined;
      let nearestLamp: Station | undefined;
      let nearestD = Infinity;
      const fogScatter = Math.min(1, fogDensity / 6e-4);
      for (const s of stations) {
        const dx = camera.x - s.lamp.x;
        const dz = camera.z - s.lamp.z;
        const dist = Math.hypot(dx, camera.y - s.lamp.y, dz);
        const level = dusk * s.strength;
        const def = s.placed.def;
        const flashing = def.characteristic.kind === 'flashing';

        const station = dist < STATION_FAR_M;
        s.group.visible = station;
        if (station) drawn += s.windows ? 3 : 2;
        // The lamp burns inside the lantern all night, whether the lens flashes or not.
        glow.copy(s.color).multiplyScalar(1.7 * dusk);
        (s.lantern.uniforms.uEmissive.value as THREE.Color).copy(glow);
        if (s.windows) {
          (s.windows.uniforms.uEmissive.value as THREE.Color)
            .copy(windowGlow)
            .multiplyScalar(0.9 * dusk);
        }

        // The glare: the lamp's glow, swelling as a flashing beam sweeps past the viewer.
        // Radians clockwise from north, from the light to the viewer.
        const toViewer = Math.atan2(dx, -dz);
        const seen = flashing ? flashSeen(def, nowS, toViewer) : 0;
        const transmit = Math.exp(-((fogDensity * LAMP_FOG_SHARE * dist) ** 2));
        const reach = 1 - smoothstep(0.75, 1.1, dist / s.rangeM);
        const base = flashing ? 0.22 : 0.85;
        const opacity = Math.min(
          1,
          level * (base + (flashing ? 1.1 * seen : 0)) * transmit * reach,
        );
        s.glare.visible = opacity > 0.01;
        if (s.glare.visible) {
          drawn++;
          lit++;
          (s.glare.material as THREE.SpriteMaterial).opacity = opacity;
          (s.glare.material as THREE.SpriteMaterial).color.copy(s.color).multiplyScalar(s.gain);
          const size = 5 + dist * (0.026 + (flashing ? 0.05 * seen : 0));
          s.glare.scale.set(size, size, 1);
        }

        if (s.beam && s.beamPivot && s.beamMaterial) {
          const on = beams && level > 0.02 && dist < s.rangeM * 1.2;
          s.beamPivot.visible = on;
          if (on) {
            drawn++;
            s.beamPivot.rotation.y = -beamBearing(def, nowS);
            const u = s.beamMaterial.uniforms as BeamUniforms;
            u.uIntensity.value = level * 1.3;
            u.uScatter.value = 0.4 + 2.2 * fogScatter;
            u.uExtinction.value = Math.max(1 / 5000, fogDensity * 1.1);
          }
        }

        if (level > 0.02 && dist < nearestD) {
          nearestD = dist;
          nearestLamp = s;
        }
        if (!nearest || dist < nearest.distanceM) {
          nearest = { id: def.id, name: def.name, distanceM: dist, level, flashing };
        }
      }

      // One real lamp on the ground: the nearest lit light, within reach.
      if (nearestLamp && nearestD < LAMP_REACH_M) {
        lampColor.copy(nearestLamp.color).multiplyScalar(1.4 * dusk * nearestLamp.strength);
        lighting.setLamp(nearestLamp.lamp, lampColor, LAMP_REACH_M);
      } else {
        lighting.setLamp(UNLIT, lampColor.setRGB(0, 0, 0), LAMP_REACH_M);
      }
    },
    dispose() {
      texture.dispose();
      for (const s of stations) {
        for (const m of s.meshes) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        (s.glare.material as THREE.Material).dispose();
        s.beam?.geometry.dispose();
        s.beamMaterial?.dispose();
      }
    },
  };
}

const UNLIT = new THREE.Vector3(0, -1e4, 0);
