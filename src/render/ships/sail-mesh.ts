import * as THREE from 'three';

/**
 * One sail: a curved patch between four corners (a triangle sail repeats its head), with
 * a 1-pixel edge line around it for style B (plan 14 §3.3). The shape is static per sail
 * level (plan 02 §13, no billow shader): it is rebuilt only when the hoist, the belly
 * side or the drawing/luffing state changes, and stays put while the sail is settled.
 *
 * The geometry is indexed so the style pass keeps its smooth normals (outline.ts
 * `creaseNormals` skips indexed meshes) and tagged `noOutline`: an inverted-hull shell
 * would go stale when the shape changes, so the sail draws its own edge line instead.
 */

const COLUMNS = 8;
const ROWS = 8;

export interface SailCorners {
  /** Luff foot (tack), leech foot (clew), leech head (peak), luff head (throat or head). */
  tack: THREE.Vector3;
  clew: THREE.Vector3;
  peak: THREE.Vector3;
  head: THREE.Vector3;
}

export interface SailShapeParams {
  /** Unit vector the belly bulges along: to leeward. */
  belly: THREE.Vector3;
  /** Depth as a fraction of the chord. */
  camber: number;
  /** The slack shape: almost flat, with ripples running to the leech. */
  luffing: boolean;
}

const a = new THREE.Vector3();
const b = new THREE.Vector3();
const p = new THREE.Vector3();

export class SailMesh {
  readonly mesh: THREE.Mesh;
  readonly edge: THREE.LineLoop;
  private readonly positions: Float32Array;
  private readonly edgePositions: Float32Array;
  /** Grid vertex indices around the edge: foot, leech, head, luff. */
  private readonly perimeter: number[];
  private key = '';

  constructor(material: THREE.Material, edgeMaterial: THREE.LineBasicMaterial, name: string) {
    const count = (COLUMNS + 1) * (ROWS + 1);
    this.positions = new Float32Array(count * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const index: number[] = [];
    const at = (c: number, r: number): number => r * (COLUMNS + 1) + c;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLUMNS; c++) {
        index.push(
          at(c, r),
          at(c + 1, r),
          at(c + 1, r + 1),
          at(c, r),
          at(c + 1, r + 1),
          at(c, r + 1),
        );
      }
    }
    geometry.setIndex(index);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = name;
    this.mesh.userData['noOutline'] = true;

    const perimeter: number[] = [];
    for (let c = 0; c < COLUMNS; c++) perimeter.push(at(c, 0));
    for (let r = 0; r < ROWS; r++) perimeter.push(at(COLUMNS, r));
    for (let c = COLUMNS; c > 0; c--) perimeter.push(at(c, ROWS));
    for (let r = ROWS; r > 0; r--) perimeter.push(at(0, r));
    this.perimeter = perimeter;
    this.edgePositions = new Float32Array(perimeter.length * 3);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.BufferAttribute(this.edgePositions, 3));
    this.edge = new THREE.LineLoop(edgeGeometry, edgeMaterial);
    this.edge.name = `${name}-edge`;
    this.edge.userData['outline'] = true;
    this.mesh.add(this.edge);
  }

  /**
   * Rebuilds the shape if `key` differs from the last call's (the caller folds the hoist,
   * belly side and luffing state into it). Returns whether it rebuilt.
   */
  shape(key: string, corners: SailCorners, params: SailShapeParams): boolean {
    if (key === this.key) return false;
    this.key = key;
    const { tack, clew, peak, head } = corners;
    for (let r = 0; r <= ROWS; r++) {
      const w = r / ROWS;
      a.lerpVectors(tack, head, w); // luff
      b.lerpVectors(clew, peak, w); // leech
      const chord = a.distanceTo(b);
      for (let c = 0; c <= COLUMNS; c++) {
        const u = c / COLUMNS;
        p.lerpVectors(a, b, u);
        let depth: number;
        if (params.luffing) {
          // Slack cloth: a little belly and ripples that grow toward the free leech.
          depth =
            params.camber * 0.2 * chord * Math.sin(Math.PI * u) +
            0.09 * u * Math.sin(Math.PI * 2 * (2.5 * u + 1.5 * w));
        } else {
          // Deepest 40% aft of the luff; the boom and the gaff flatten the foot and head.
          const along = Math.sin(Math.PI * u ** 0.75);
          const up = 0.45 + 0.55 * Math.sin(Math.PI * w);
          depth = params.camber * chord * along * up;
        }
        p.addScaledVector(params.belly, depth);
        const i = (r * (COLUMNS + 1) + c) * 3;
        this.positions[i] = p.x;
        this.positions[i + 1] = p.y;
        this.positions[i + 2] = p.z;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.boundingBox = null;

    this.perimeter.forEach((vertex, k) => {
      this.edgePositions[k * 3] = this.positions[vertex * 3] as number;
      this.edgePositions[k * 3 + 1] = this.positions[vertex * 3 + 1] as number;
      this.edgePositions[k * 3 + 2] = this.positions[vertex * 3 + 2] as number;
    });
    this.edge.geometry.getAttribute('position').needsUpdate = true;
    this.edge.geometry.computeBoundingSphere();
    return true;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
  }
}
