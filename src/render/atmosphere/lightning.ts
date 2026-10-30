import * as THREE from 'three';

/**
 * Lightning for thunderstorms (plan 04 §9, Phase 2 piece E): a flash that lights the whole
 * scene for a moment from where it struck, and, for cloud-to-water strikes, a jagged bolt
 * standing on the lake. The flash is a double peak a few tenths of a second long (a strong
 * stroke and a weaker return), fainter for farther strikes. Strikes are scheduled from a
 * seeded generator, more often the stronger the storm, and each is announced to listeners
 * with its bearing and distance, so the audio piece can delay the thunder by distance
 * (about 3 s a kilometer).
 */

export interface Strike {
  /** Radians clockwise from north, from the camera to the strike. */
  bearingRad: number;
  distanceM: number;
  /** A bolt reached the water (otherwise the flash stayed in the cloud). */
  toWater: boolean;
}

export interface Lightning {
  readonly group: THREE.Group;
  /** The flash now, 0–1, and the direction of the strike that makes it. */
  readonly flash01: number;
  readonly direction: THREE.Vector3;
  /** Strikes so far, for the readout. */
  readonly strikes: number;
  onStrike(listener: (strike: Strike) => void): void;
  /** Forces one now, for tests and the dev panel. */
  strikeNow(camera: THREE.Vector3): void;
  /** `dt` real seconds; `storm01` and `rain01` from the weather. */
  update(dt: number, storm01: number, rain01: number, camera: THREE.Vector3): void;
  dispose(): void;
}

/** Cloud base height for the top of a bolt, meters. */
const CLOUD_BASE_M = 650;
const MIN_DISTANCE_M = 900;
const MAX_DISTANCE_M = 6500;
/** The speed of sound, m/s, for whoever times the thunder. */
export const SOUND_MS = 343;

/** The flash curve: a strong stroke and a weaker return stroke, `tau` seconds in. */
export function flashAt(tau: number): number {
  if (tau < 0 || tau > 0.8) return 0;
  const stroke = Math.exp(-tau * 22);
  const ret = tau >= 0.16 ? 0.6 * Math.exp(-(tau - 0.16) * 18) : 0;
  return Math.min(1, stroke + ret);
}

export function createLightning(seed = 0x1f57): Lightning {
  const group = new THREE.Group();
  group.name = 'lightning';
  let state = seed | 0;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const material = new THREE.LineBasicMaterial({
    color: 0xdfe8ff,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const bolt = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  bolt.name = 'bolt';
  bolt.frustumCulled = false;
  bolt.visible = false;
  bolt.renderOrder = 4;
  group.add(bolt);

  const listeners: ((strike: Strike) => void)[] = [];
  const direction = new THREE.Vector3(0, 0.3, -1).normalize();
  let clock = 0;
  let nextAt = 6;
  let startedAt = -10;
  let strength = 1;
  let strikes = 0;

  /** A jagged line from the cloud to the water by midpoint displacement, as segments. */
  const buildBolt = (x: number, z: number): void => {
    const points: THREE.Vector3[] = [
      new THREE.Vector3(x, CLOUD_BASE_M, z),
      new THREE.Vector3(x + (rand() - 0.5) * 60, 0, z + (rand() - 0.5) * 60),
    ];
    let jitter = 120;
    for (let level = 0; level < 6; level++) {
      const next: THREE.Vector3[] = [];
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i] as THREE.Vector3;
        const b = points[i + 1] as THREE.Vector3;
        next.push(a);
        next.push(
          new THREE.Vector3(
            (a.x + b.x) / 2 + (rand() - 0.5) * jitter,
            (a.y + b.y) / 2,
            (a.z + b.z) / 2 + (rand() - 0.5) * jitter,
          ),
        );
      }
      next.push(points[points.length - 1] as THREE.Vector3);
      points.splice(0, points.length, ...next);
      jitter *= 0.55;
    }
    const verts: number[] = [];
    const push = (a: THREE.Vector3, b: THREE.Vector3): void => {
      verts.push(a.x, a.y, a.z, b.x, b.y, b.z);
    };
    for (let i = 0; i < points.length - 1; i++) {
      push(points[i] as THREE.Vector3, points[i + 1] as THREE.Vector3);
    }
    // One or two forks, each a short jagged run off a point in the upper half.
    for (let f = 0; f < 2; f++) {
      const from = points[Math.floor(points.length * (0.1 + 0.4 * rand()))] as THREE.Vector3;
      let prev = from;
      const dx = (rand() - 0.5) * 18;
      const dz = (rand() - 0.5) * 18;
      for (let s = 0; s < 8; s++) {
        const p = new THREE.Vector3(
          prev.x + dx + (rand() - 0.5) * 16,
          prev.y - 28 - rand() * 18,
          prev.z + dz + (rand() - 0.5) * 16,
        );
        push(prev, p);
        prev = p;
      }
    }
    bolt.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    bolt.geometry = g;
  };

  const strike = (camera: THREE.Vector3): void => {
    const bearing = rand() * Math.PI * 2;
    const distance = MIN_DISTANCE_M + (MAX_DISTANCE_M - MIN_DISTANCE_M) * rand() ** 1.4;
    const toWater = rand() < 0.6;
    const x = camera.x + Math.sin(bearing) * distance;
    const z = camera.z - Math.cos(bearing) * distance;
    direction.set(Math.sin(bearing), 0.3, -Math.cos(bearing)).normalize();
    if (toWater) buildBolt(x, z);
    bolt.visible = toWater;
    startedAt = clock;
    strength = Math.min(1, Math.max(0.25, 1.25 - distance / 7000));
    strikes++;
    for (const l of listeners) l({ bearingRad: bearing, distanceM: distance, toWater });
  };

  return {
    group,
    get flash01() {
      return strength * flashAt(clock - startedAt);
    },
    direction,
    get strikes() {
      return strikes;
    },
    onStrike(listener) {
      listeners.push(listener);
    },
    strikeNow: strike,
    update(dt, storm01, rain01, camera) {
      clock += dt;
      const active = storm01 > 0.08 && rain01 > 0.1;
      if (!active) {
        // A storm that ends mid-count starts its next wait afresh.
        nextAt = clock + 6;
      } else if (clock >= nextAt) {
        strike(camera);
        // A strike every 5–25 s, sooner the stronger the storm.
        const mean = 28 - 23 * Math.min(1, storm01);
        nextAt = clock + mean * (0.4 + 1.2 * rand());
      }
      const f = strength * flashAt(clock - startedAt);
      if (bolt.visible) {
        // The bolt shows for the first stroke and the return, then goes out.
        bolt.visible = clock - startedAt < 0.4;
        material.opacity = Math.min(1, f * 1.6);
      }
    },
    dispose() {
      bolt.geometry.dispose();
      material.dispose();
    },
  };
}
