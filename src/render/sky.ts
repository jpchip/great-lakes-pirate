import * as THREE from 'three';

/**
 * A gradient sky dome that follows the camera (plan 04 §9). Its horizon color is the fog
 * color, so the water edge disappears into it. One draw call, no lighting.
 *
 * With `bodies` it also draws the sun and a phased moon disc, a warm glow around the sun
 * near the horizon and a hashed star field that fades in on clear nights: the Phase 1
 * day/night sky. Driven each frame by render/environment.ts.
 */
export interface SkyUniforms {
  [name: string]: THREE.IUniform;
  uHorizon: THREE.IUniform<THREE.Color>;
  uZenith: THREE.IUniform<THREE.Color>;
  uSunDirection: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  /** Sun disc and glow strength, 0–1 (cloud hides them). */
  uSunVisible: THREE.IUniform<number>;
  uGlowColor: THREE.IUniform<THREE.Color>;
  uMoonDirection: THREE.IUniform<THREE.Vector3>;
  /** 0 = new, 0.5 = full. */
  uMoonPhase: THREE.IUniform<number>;
  uMoonVisible: THREE.IUniform<number>;
  uStars: THREE.IUniform<number>;
}

export type Sky = THREE.Mesh<
  THREE.SphereGeometry,
  THREE.ShaderMaterial & { uniforms: SkyUniforms }
>;

export function createSky(horizon: THREE.Color, zenith: THREE.Color, bodies = false): Sky {
  const uniforms: SkyUniforms = {
    uHorizon: { value: horizon },
    uZenith: { value: zenith },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(0xfff2d6) },
    uSunVisible: { value: 0 },
    uGlowColor: { value: new THREE.Color(0xf2a35e) },
    uMoonDirection: { value: new THREE.Vector3(0, -1, 0) },
    uMoonPhase: { value: 0.5 },
    uMoonVisible: { value: 0 },
    uStars: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: bodies ? { SKY_BODIES: '' } : {},
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      uniform vec3 uSunDirection;
      uniform vec3 uSunColor;
      uniform float uSunVisible;
      uniform vec3 uGlowColor;
      uniform vec3 uMoonDirection;
      uniform float uMoonPhase;
      uniform float uMoonVisible;
      uniform float uStars;
      varying vec3 vDirection;

      float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      void main() {
        vec3 dir = normalize(vDirection);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 color = mix(uHorizon, uZenith, pow(h, 0.6));
        #ifdef SKY_BODIES
        // Warm band around the low sun: strongest toward it and near the horizon.
        float sunward = max(dot(dir, uSunDirection), 0.0);
        float low = 1.0 - smoothstep(-0.05, 0.35, uSunDirection.y);
        float band = (1.0 - smoothstep(0.0, 0.45, h)) * low;
        color = mix(color, uGlowColor, pow(sunward, 3.0) * band * 0.75 * uSunVisible);

        // Stars on a hashed grid of directions, twinkle-free (no time uniform).
        if (uStars > 0.0 && dir.y > 0.0) {
          // A point near the middle of a few cells in a thousand, so stars stay small.
          vec3 grid = dir * 420.0;
          vec3 cell = floor(grid);
          float star = step(0.985, hash3(cell)) * (1.0 - smoothstep(0.12, 0.22, length(fract(grid) - 0.5)));
          float fadeLow = smoothstep(0.02, 0.2, dir.y);
          color += vec3(0.8, 0.85, 1.0) * star * uStars * fadeLow * (0.5 + 0.5 * hash3(cell + 7.0));
        }

        // Sun disc with a soft halo.
        float sunCos = dot(dir, uSunDirection);
        float disc = smoothstep(0.99955, 0.99975, sunCos);
        float halo = pow(max(sunCos, 0.0), 400.0) * 0.4;
        color = mix(color, uSunColor * 1.4, clamp(disc + halo, 0.0, 1.0) * uSunVisible);

        // Moon disc, lit on the side facing the sun by its phase.
        // About 2° across, four times life size, so it reads on screen.
        const float MOON_COS = 0.99985;
        float moonCos = dot(dir, uMoonDirection);
        float moonDisc = smoothstep(MOON_COS - 0.000012, MOON_COS + 0.000012, moonCos);
        if (moonDisc > 0.0) {
          // Disc axes: "toward" points at the sun across the sky, so that limb is lit.
          vec3 m = normalize(uMoonDirection);
          vec3 toward = uSunDirection - m * dot(uSunDirection, m);
          toward = length(toward) > 1e-4 ? normalize(toward) : normalize(cross(vec3(0.0, 1.0, 0.0), m) + vec3(1e-4, 0.0, 0.0));
          vec3 across = cross(m, toward);
          float r = sqrt(1.0 - MOON_COS * MOON_COS);
          vec2 q = vec2(dot(dir - m, toward), dot(dir - m, across)) / r;
          // The terminator is a half-ellipse whose width follows the phase.
          float edge = cos(uMoonPhase * 6.2831853) * sqrt(max(1.0 - min(q.y * q.y, 1.0), 0.0));
          float lit = smoothstep(-0.06, 0.06, q.x - edge);
          vec3 moonColor = mix(color * 1.1, vec3(0.92, 0.93, 0.88), lit);
          color = mix(color, moonColor, moonDisc * uMoonVisible);
        }
        #endif
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3000, 32, 16),
    material as THREE.ShaderMaterial & { uniforms: SkyUniforms },
  );
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
