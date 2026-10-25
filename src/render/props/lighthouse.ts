import * as THREE from 'three';
import { PALETTE, paletteColor } from '../style/palette';

/**
 * A procedural light station for the S4 style test (plan 14 §3.2): a white conical tower
 * with a black lantern, a red-brick keeper's house and a rock islet, plus the rotating
 * beam and lamp glare (plan 14 §10: "sprites plus a cone shader"). It stands in for the
 * Phase 2 lighthouse kit. Meshes carry plain Lambert materials as color carriers; the
 * style test swaps them to the stylized material. The beam and glare keep their own.
 *
 * Local frame: islet center at the origin, waterline at y = 0.
 */

const TOWER_BASE_Y = 4;
const TOWER_HEIGHT = 17;
const LAMP_Y = TOWER_BASE_Y + TOWER_HEIGHT + 1.3;
/** Beam reach, meters. Fog and the fade hide the tip long before this. */
const BEAM_LENGTH = 700;
/** One revolution, seconds (a flash every 7.5 s with two opposed beams). */
const PERIOD_S = 15;

const solid = (
  geometry: THREE.BufferGeometry,
  color: number,
  extra: { emissive?: THREE.Color } = {},
): THREE.Mesh => {
  // Non-indexed, so creaseNormals() can give toon shading clean hard edges.
  const material = new THREE.MeshLambertMaterial({ color });
  if (extra.emissive) material.emissive = extra.emissive;
  return new THREE.Mesh(geometry.toNonIndexed(), material);
};

function islet(): THREE.Group {
  const group = new THREE.Group();
  // A low, lumpy sandstone shelf with a darker wet-rock skirt at the waterline.
  const shelf = new THREE.CylinderGeometry(16, 22, 5, 11, 1);
  const p = shelf.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const angle = Math.atan2(p.getZ(i), p.getX(i));
    const wobble = 1 + 0.12 * Math.sin(angle * 3 + 1.3) + 0.07 * Math.sin(angle * 7);
    p.setXYZ(i, p.getX(i) * wobble, p.getY(i), p.getZ(i) * wobble);
  }
  const top = solid(shelf, PALETTE.sandstone);
  top.position.y = 1.6;
  const skirt = solid(new THREE.CylinderGeometry(22.5, 25, 2.2, 11, 1), PALETTE.wetRock);
  skirt.position.y = -0.6;
  group.add(top, skirt);
  return group;
}

function tower(lampGlass: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  const shaft = solid(new THREE.CylinderGeometry(1.7, 2.4, TOWER_HEIGHT, 8, 1), PALETTE.towerWhite);
  shaft.position.y = TOWER_BASE_Y + TOWER_HEIGHT / 2;
  const gallery = solid(new THREE.CylinderGeometry(2.7, 2.7, 0.35, 8), PALETTE.lanternBlack);
  gallery.position.y = TOWER_BASE_Y + TOWER_HEIGHT + 0.15;
  const lantern = solid(new THREE.CylinderGeometry(1.25, 1.25, 2.2, 8), PALETTE.lanternBlack, {
    emissive: lampGlass,
  });
  lantern.name = 'lantern';
  lantern.position.y = LAMP_Y;
  const roof = solid(new THREE.ConeGeometry(1.6, 1.5, 8), PALETTE.lanternBlack);
  roof.position.y = LAMP_Y + 1.85;
  group.add(shaft, gallery, lantern, roof);
  return group;
}

function keepersHouse(glow: THREE.Color): THREE.Group {
  const group = new THREE.Group();
  const walls = solid(new THREE.BoxGeometry(8, 4.5, 6), PALETTE.brick);
  walls.position.y = 4.25 + 2.25;
  // Gable roof: a triangular prism along the house's long axis.
  const shape = new THREE.Shape([
    new THREE.Vector2(-3.5, 0),
    new THREE.Vector2(3.5, 0),
    new THREE.Vector2(0, 2.6),
  ]);
  const prism = new THREE.ExtrudeGeometry(shape, { depth: 8.6, bevelEnabled: false });
  prism.rotateY(Math.PI / 2);
  prism.translate(-4.3, 0, 0);
  const roof = solid(prism, PALETTE.roofGray);
  roof.position.y = 8.75;
  group.add(walls, roof);
  for (const x of [-2, 2]) {
    const pane = solid(new THREE.BoxGeometry(1, 1.4, 0.1), PALETTE.lanternBlack, {
      emissive: glow,
    });
    pane.name = 'window';
    pane.userData['noOutline'] = true;
    pane.position.set(x, 6.6, 3.02);
    group.add(pane);
  }
  group.position.set(-9, 0, 5);
  group.rotation.y = 0.35;
  return group;
}

export interface BeamUniforms {
  [name: string]: THREE.IUniform;
  uColor: THREE.IUniform<THREE.Color>;
  uIntensity: THREE.IUniform<number>;
  /** How much light the air scatters toward the eye; fog raises it. */
  uScatter: THREE.IUniform<number>;
  /** Fraction lost per meter between the beam and the eye. */
  uExtinction: THREE.IUniform<number>;
  uLength: THREE.IUniform<number>;
}

const beamVertex = /* glsl */ `
uniform float uLength;
varying float vAlong;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying float vOutside;
void main() {
  // Seen from inside the cone, its far wall would wash over the whole screen with a hard
  // edge. Fade the cone out as the eye nears its axis; the glare sprite carries the flash.
  vec3 apex = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 axis = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  float cosToEye = dot(axis, normalize(cameraPosition - apex));
  vOutside = 1.0 - smoothstep(0.985, 0.997, cosToEye);
  // The cone's apex is at the lamp (y = 0 after the shift below), its mouth at uLength.
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

function beamMaterial(): THREE.ShaderMaterial & { uniforms: BeamUniforms } {
  const uniforms: BeamUniforms = {
    uColor: { value: paletteColor('lampAmber') },
    uIntensity: { value: 1 },
    uScatter: { value: 0.5 },
    uExtinction: { value: 1 / 1500 },
    uLength: { value: BEAM_LENGTH },
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
  return material as THREE.ShaderMaterial & { uniforms: BeamUniforms };
}

function glareTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface Lighthouse {
  readonly group: THREE.Group;
  readonly beam: THREE.Group;
  readonly beamUniforms: BeamUniforms;
  /** The lamp in world space (for the stylized material's local light). */
  lampPosition(out: THREE.Vector3): THREE.Vector3;
  /** Lamp brightness: lantern glass, windows, glare and beam (0 = off). */
  setLamp(intensity: number): void;
  setAtmosphere(scatter: number, extinction: number): void;
  update(timeS: number, camera: THREE.Camera): void;
}

export function createLighthouse(): Lighthouse {
  const group = new THREE.Group();
  group.name = 'lighthouse';
  const lampGlass = new THREE.Color();
  const windowGlow = new THREE.Color();
  group.add(islet(), tower(lampGlass), keepersHouse(windowGlow));

  // Two opposed beams from one Fresnel lens, rotating about the tower.
  const material = beamMaterial();
  const beam = new THREE.Group();
  beam.position.y = LAMP_Y;
  for (const side of [0, Math.PI]) {
    const cone = new THREE.CylinderGeometry(55, 0.6, BEAM_LENGTH, 64, 1, true);
    cone.translate(0, BEAM_LENGTH / 2, 0); // apex at the lamp
    const mesh = new THREE.Mesh(cone, material);
    mesh.rotation.set(0, side, -Math.PI / 2 - 0.03); // horizontal, tipped slightly down
    mesh.userData['keepMaterial'] = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    beam.add(mesh);
  }
  group.add(beam);

  const glare = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glareTexture(),
      color: paletteColor('lampAmber'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  glare.position.y = LAMP_Y;
  glare.userData['keepMaterial'] = true;
  glare.renderOrder = 3;
  group.add(glare);

  let lamp = 1;
  const beamDirection = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const lampWorld = new THREE.Vector3();

  const lighthouse: Lighthouse = {
    group,
    beam,
    beamUniforms: material.uniforms,
    lampPosition(out) {
      return out.set(0, LAMP_Y, 0).applyMatrix4(group.matrixWorld);
    },
    setLamp(intensity) {
      lamp = intensity;
      lampGlass.copy(paletteColor('lampAmber')).multiplyScalar(1.6 * intensity);
      windowGlow.copy(paletteColor('windowAmber')).multiplyScalar(0.9 * intensity);
      material.uniforms.uIntensity.value = intensity;
      glare.visible = intensity > 0;
      // Emissive colors are copied into the stylized materials when they are built,
      // so push the new values into any that exist.
      group.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const u = (node.material as THREE.ShaderMaterial).uniforms as
          Record<string, THREE.IUniform> | undefined;
        const glow =
          node.name === 'lantern' ? lampGlass : node.name === 'window' ? windowGlow : null;
        if (glow && u?.['uEmissive']) (u['uEmissive'].value as THREE.Color).copy(glow);
        if (glow && node.material instanceof THREE.MeshLambertMaterial) {
          node.material.emissive.copy(glow);
        }
      });
    },
    setAtmosphere(scatter, extinction) {
      material.uniforms.uScatter.value = scatter;
      material.uniforms.uExtinction.value = extinction;
    },
    update(timeS, camera) {
      beam.rotation.y = ((timeS % PERIOD_S) / PERIOD_S) * Math.PI * 2;
      // The glare swells as a beam sweeps across the viewer.
      lighthouse.lampPosition(lampWorld);
      toCamera.copy(camera.position).sub(lampWorld).setY(0).normalize();
      beamDirection.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, beam.rotation.y);
      const facing = Math.abs(beamDirection.dot(toCamera));
      const flash = Math.pow(facing, 24);
      glare.material.opacity = Math.min(1, lamp * (0.35 + 0.65 * flash));
      const size = 5 + 14 * flash;
      glare.scale.set(size, size, 1);
    },
  };
  lighthouse.setLamp(1);
  return lighthouse;
}
