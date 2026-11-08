import * as THREE from 'three';
import type { ArcPreview } from '../sim/combat/aim';

/**
 * The aim preview (plan 07 §3; Phase 6 piece B): a dotted line along the shot's flight and
 * a splash ring where it falls, drawn over everything like a pencil mark on the view. The
 * dots stop where the eye gives out at night or in fog, and the ring isn't drawn past it.
 * Cream while the gun is ready, a dull red while it isn't.
 */

const DOTS = 64;
const READY = new THREE.Color(0xf2e6c8);
const NOT_READY = new THREE.Color(0xc0503a);

export interface AimPreviewView {
  readonly group: THREE.Group;
  /** The preview to draw this frame; undefined hides it. */
  update(preview: ArcPreview | undefined, ready: boolean, cameraPos: THREE.Vector3): void;
}

export function createAimView(): AimPreviewView {
  const group = new THREE.Group();
  group.name = 'aim-preview';
  group.visible = false;

  const positions = new Float32Array(DOTS * 3);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
  );
  const dotMat = new THREE.PointsMaterial({
    color: READY,
    size: 5,
    sizeAttenuation: false,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
    fog: false,
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  dots.frustumCulled = false;
  dots.renderOrder = 10;
  group.add(dots);

  const ringMat = new THREE.MeshBasicMaterial({
    color: READY,
    depthTest: false,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    fog: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48).rotateX(-Math.PI / 2), ringMat);
  ring.renderOrder = 10;
  group.add(ring);
  // A small cross at the ring's heart: where the shot is laid.
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.12).rotateX(-Math.PI / 2), ringMat);
  const cross2 = cross.clone();
  cross2.rotation.y = Math.PI / 2;
  cross.renderOrder = 10;
  cross2.renderOrder = 10;
  group.add(cross, cross2);

  return {
    group,
    update(preview, ready, cameraPos) {
      if (!preview || preview.points.length === 0) {
        group.visible = false;
        return;
      }
      group.visible = true;
      const color = ready ? READY : NOT_READY;
      dotMat.color.copy(color);
      ringMat.color.copy(color);
      const n = Math.min(DOTS, preview.points.length);
      for (let i = 0; i < n; i++) {
        const p = preview.points[i];
        if (!p) continue;
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = Math.max(p.y, 0.3);
        positions[i * 3 + 2] = p.z;
      }
      dotGeo.setDrawRange(0, n);
      (dotGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      const s = preview.splash;
      ring.visible = !!s;
      cross.visible = !!s;
      cross2.visible = !!s;
      if (s) {
        // Never thinner than about a degree of the view, so a far ring still reads.
        const d = Math.hypot(s.x - cameraPos.x, s.z - cameraPos.z, cameraPos.y);
        const r = Math.max(s.radiusM, d * 0.02);
        ring.position.set(s.x, 0.4, s.z);
        ring.scale.setScalar(r);
        cross.position.set(s.x, 0.4, s.z);
        cross2.position.set(s.x, 0.4, s.z);
        cross.scale.set(r * 0.6, 1, r * 0.6);
        cross2.scale.set(r * 0.6, 1, r * 0.6);
      }
    },
  };
}
