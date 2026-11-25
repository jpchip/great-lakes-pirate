import * as THREE from 'three';
import type { DistrictModel } from '../../gameplay/district/district';
import { FLAG_POLE_M } from './kit-meshes';
import { chimneys, flagpole, idHash } from './styles';

/**
 * What moves in a district (the 0.9 district polish): smoke from the chimneys of the
 * houses, the saloon and the cooperage, gulls wheeling over the piers by day, and the flag
 * on the harbor office, the police and the depot. Smoke and gulls are an instanced mesh
 * each; each flag is a small plane whose cloth is rippled on the CPU. A few draw calls in
 * all, and nothing a guard or a collider needs to know about.
 */

export interface DistrictLife {
  readonly objects: THREE.Object3D[];
  /** `t` seconds since the view was made, `night` 0 by day to 1 at night. */
  update(t: number, night: number): void;
  dispose(): void;
}

const PUFFS = 7;
const PUFF_LIFE_S = 7;
/** Which way the smoke leans: a light westerly off the hills. */
const DRIFT = new THREE.Vector3(0.38, 0, 0.12);

function flagTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 190;
  canvas.height = 100;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Thirteen stripes and a canton of forty-five stars (the flag of 1896–1908).
    for (let k = 0; k < 13; k++) {
      ctx.fillStyle = k % 2 ? '#efe9dc' : '#b3392b';
      ctx.fillRect(0, (k * 100) / 13, 190, 100 / 13 + 1);
    }
    ctx.fillStyle = '#2b3a64';
    ctx.fillRect(0, 0, 76, (7 * 100) / 13);
    ctx.fillStyle = '#efe9dc';
    for (let r = 0; r < 6; r++)
      for (let c = 0; c < (r % 2 ? 7 : 8); c++) {
        ctx.beginPath();
        ctx.arc(5 + c * 9.5 + (r % 2 ? 4.5 : 0), 5 + r * 8.4, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A gull: a little body and two wings in a shallow V, along x, tips at ±0.55. */
function gullGeometry(): THREE.BufferGeometry {
  const v = [
    // Left wing, right wing (both faces drawn: the material is double-sided).
    0, 0, -0.08, -0.55, 0.12, 0.02, 0, 0, 0.1, 0, 0, -0.08, 0, 0, 0.1, 0.55, 0.12, 0.02,
    // Body.
    0, -0.03, -0.18, -0.05, 0, 0.18, 0.05, 0, 0.18,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export function createDistrictLife(model: DistrictModel): DistrictLife {
  const objects: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];

  // --- Chimney smoke -----------------------------------------------------------------------
  const stacks = model.buildings.flatMap((b) => chimneys(b));
  const smokeGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const smokeMat = new THREE.MeshBasicMaterial({
    color: 0xbdbab2,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const smoke = new THREE.InstancedMesh(smokeGeo, smokeMat, Math.max(1, stacks.length * PUFFS));
  smoke.name = 'chimney-smoke';
  smoke.frustumCulled = false;
  smoke.count = stacks.length * PUFFS;
  objects.push(smoke);
  disposables.push(smokeGeo, smokeMat);
  const phase = stacks.map((c) => idHash(`${c.x}:${c.z}`));

  // --- Gulls over the piers -----------------------------------------------------------------
  const piers = model.marks.filter((m) => m.kind === 'gangway');
  const gulls = piers.flatMap((m, k) =>
    Array.from({ length: 5 }, (_, j) => {
      const r = idHash(`${m.id}:${j}`);
      return {
        cx: m.x + (r - 0.5) * 16,
        cz: m.z + (idHash(`${m.id}z${j}`) - 0.5) * 12,
        radius: 9 + r * 14,
        y: 10 + ((j * 3.7 + k) % 7),
        speed: (0.22 + r * 0.18) * (j % 2 ? 1 : -1),
        phase: r * Math.PI * 2,
        flap: 2.6 + r * 1.6,
      };
    }),
  );
  const gullGeo = gullGeometry();
  const gullMat = new THREE.MeshBasicMaterial({ color: 0xe9e7e0, side: THREE.DoubleSide });
  const gullMesh = new THREE.InstancedMesh(gullGeo, gullMat, Math.max(1, gulls.length));
  gullMesh.name = 'gulls';
  gullMesh.frustumCulled = false;
  gullMesh.count = gulls.length;
  objects.push(gullMesh);
  disposables.push(gullGeo, gullMat);

  // --- Flags ----------------------------------------------------------------------------------
  const poles = model.buildings.flatMap((b) => {
    const f = flagpole(b);
    return f ? [f] : [];
  });
  const flagTex = poles.length > 0 ? flagTexture() : undefined;
  const flagMat = new THREE.MeshBasicMaterial({ map: flagTex ?? null, side: THREE.DoubleSide });
  disposables.push(flagMat);
  if (flagTex) disposables.push(flagTex);
  const flags = poles.map((p, k) => {
    const geo = new THREE.PlaneGeometry(1.7, 0.9, 10, 2);
    geo.translate(0.85 + 0.05, 0, 0);
    const base = Float32Array.from(geo.getAttribute('position').array);
    const mesh = new THREE.Mesh(geo, flagMat);
    mesh.name = `flag:${k}`;
    mesh.position.set(p.x, p.y - 0.2 + FLAG_POLE_M - 0.55, p.z);
    // Streaming downwind.
    mesh.rotation.y = -Math.atan2(DRIFT.z, DRIFT.x);
    mesh.frustumCulled = false;
    objects.push(mesh);
    disposables.push(geo);
    return { geo, base, phase: k * 1.7 };
  });

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const day = new THREE.Color(0xbdbab2);
  const dark = new THREE.Color(0x2a2d33);

  return {
    objects,
    update(t, night) {
      // Smoke: each puff rises, swells and leans downwind, then thins away.
      smokeMat.color.copy(day).lerp(dark, night);
      smokeMat.opacity = 0.5 - night * 0.25;
      stacks.forEach((c, i) => {
        const pipe = c.kind === 'pipe';
        for (let k = 0; k < PUFFS; k++) {
          const age = (((t / PUFF_LIFE_S + k / PUFFS + (phase[i] ?? 0)) % 1) + 1) % 1;
          const rise = age * (pipe ? 3.2 : 4.5);
          pos.set(c.x, c.y1 + 0.2 + rise, c.z).addScaledVector(DRIFT, age * age * 9);
          const swell = (pipe ? 0.22 : 0.32) + age * (pipe ? 0.8 : 1.25);
          const fade = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1;
          const s = swell * fade * (age < 0.06 ? age / 0.06 : 1);
          scale.set(s, s * 0.85, s);
          q.setFromAxisAngle(up, age * 2 + k);
          smoke.setMatrixAt(i * PUFFS + k, m.compose(pos, q, scale));
        }
      });
      smoke.instanceMatrix.needsUpdate = true;

      // Gulls: wheel over the piers by day, gone to roost at night.
      gullMesh.visible = night < 0.6 && gulls.length > 0;
      if (gullMesh.visible) {
        gulls.forEach((g, i) => {
          const a = g.phase + t * g.speed;
          pos.set(
            g.cx + Math.cos(a) * g.radius,
            g.y + Math.sin(t * 0.3 + g.phase) * 1.2,
            g.cz + Math.sin(a) * g.radius,
          );
          // Facing along the circle, banked into the turn.
          const yaw = g.speed > 0 ? Math.PI - a : -a;
          q.setFromEuler(new THREE.Euler(0, yaw, g.speed > 0 ? -0.3 : 0.3, 'YXZ'));
          const beat = Math.sin(t * g.flap + g.phase);
          // A few beats, then a glide.
          const flapping = Math.sin(t * 0.4 + g.phase) > 0.2;
          scale.set(1, flapping ? 0.3 + beat * 1.2 : 0.55, 1);
          gullMesh.setMatrixAt(i, m.compose(pos, q, scale));
        });
        gullMesh.instanceMatrix.needsUpdate = true;
      }

      // Flags: a travelling ripple, bigger toward the fly.
      flagMat.color.setScalar(1 - night * 0.72);
      for (const f of flags) {
        const p = f.geo.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < p.count; v++) {
          const x = f.base[v * 3] ?? 0;
          const y = f.base[v * 3 + 1] ?? 0;
          const u = x / 1.75;
          p.setXYZ(v, x, y - u * 0.06, Math.sin(u * 5.5 - t * 4.2 + f.phase) * 0.14 * u);
        }
        p.needsUpdate = true;
      }
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
