import * as THREE from 'three';

/**
 * A gradient sky dome that follows the camera (plan 04 §9). Its horizon color is the fog
 * color, so the water edge disappears into it. One draw call, no lighting.
 *
 * With `bodies` it also draws the sun and a phased moon disc, a warm glow around the sun
 * near the horizon and a hashed star field that fades in on clear nights: the Phase 1
 * day/night sky. Driven each frame by render/environment.ts.
 *
 * With `clouds` it adds Phase 2 piece E's cloud layers (plan 04 §9): a low deck and a thin
 * high one, procedural noise on a plane over the camera, no volumetrics. Cover and speed
 * come from the weather; the clouds are drawn in two toon bands (lit edge, shaded body)
 * over the sun, moon and stars, so a gap in the cloud shows them and a deck hides them. A
 * storm lowers and darkens them, and lightning lights them from the flash's direction.
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
  /** Cloud cover, 0–1: how much of the sky the layers fill. */
  uCloudCover: THREE.IUniform<number>;
  /** Storm, 0–1: lower, heavier, more contrasty clouds. */
  uCloudStorm: THREE.IUniform<number>;
  /** Where the layers have drifted to, in noise units (the wind carries them). */
  uCloudOffset: THREE.IUniform<THREE.Vector2>;
  /** The sunlit and shaded cloud colors. */
  uCloudLit: THREE.IUniform<THREE.Color>;
  uCloudShade: THREE.IUniform<THREE.Color>;
  /** Lightning: strength 0–1 and the direction it came from. */
  uFlash: THREE.IUniform<number>;
  uFlashDirection: THREE.IUniform<THREE.Vector3>;
}

export type Sky = THREE.Mesh<
  THREE.SphereGeometry,
  THREE.ShaderMaterial & { uniforms: SkyUniforms }
>;

export interface SkyQuality {
  /** Cloud layers drawn: 1 is the low deck, 2 adds the high one. */
  cloudLayers: 1 | 2;
  /** Noise octaves per layer. */
  cloudOctaves: 2 | 3;
}

/** Recompiles the sky with a preset's cloud cost (layers and octaves are shader constants). */
export function setSkyQuality(sky: Sky, q: SkyQuality): void {
  const defines = sky.material.defines as Record<string, string | number>;
  if (defines['CLOUD_LAYERS'] === q.cloudLayers && defines['CLOUD_OCTAVES'] === q.cloudOctaves) {
    return;
  }
  defines['CLOUD_LAYERS'] = q.cloudLayers;
  defines['CLOUD_OCTAVES'] = q.cloudOctaves;
  sky.material.needsUpdate = true;
}

export function createSky(
  horizon: THREE.Color,
  zenith: THREE.Color,
  bodies = false,
  clouds = false,
): Sky {
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
    uCloudCover: { value: 0 },
    uCloudStorm: { value: 0 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudLit: { value: new THREE.Color(0xdfe6ea) },
    uCloudShade: { value: new THREE.Color(0x9aa6b0) },
    uFlash: { value: 0 },
    uFlashDirection: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    defines: {
      ...(bodies ? { SKY_BODIES: '' } : {}),
      ...(clouds ? { SKY_CLOUDS: '', CLOUD_LAYERS: 2, CLOUD_OCTAVES: 3 } : {}),
    },
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
      uniform float uCloudCover;
      uniform float uCloudStorm;
      uniform vec2 uCloudOffset;
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      uniform float uFlash;
      uniform vec3 uFlashDirection;
      varying vec3 vDirection;

      float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
      }

      #ifdef SKY_CLOUDS
      // Arithmetic hash (Hoskins): steadier than sin() on iGPUs.
      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
          mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      // Fractal noise normalized to 0–1.
      float fbm(vec2 p) {
        float a = 0.5;
        float s = 0.0;
        for (int k = 0; k < CLOUD_OCTAVES; k++) {
          s += a * vnoise(p);
          p = p * 2.03 + 17.1;
          a *= 0.5;
        }
        return s / (1.0 - pow(0.5, float(CLOUD_OCTAVES)));
      }

      // One layer: x = coverage alpha, y = how deep inside the cloud (0 at the ragged edge,
      // 1 in the thickest part), which sets the shaded band.
      vec2 cloudLayer(vec3 dir, float scale, vec2 offset, float cover, float height) {
        vec2 uv = dir.xz / (max(dir.y, 0.0) + height) * scale + offset;
        float d = fbm(uv);
        // The noise is centered near 0.5, so the threshold runs from 0.85 (no cloud) to 0.1.
        float t = 0.85 - 0.75 * cover;
        return vec2(smoothstep(t, t + 0.09, d), clamp((d - t) / (0.8 - t), 0.0, 1.0));
      }
      #endif

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
        #ifdef SKY_CLOUDS
        if (dir.y > 0.0 && uCloudCover > 0.01) {
          float height = mix(0.28, 0.12, uCloudStorm);
          float haze = 1.0 - smoothstep(0.0, 0.2, dir.y);
          float sunward = pow(max(dot(dir, uSunDirection), 0.0), 4.0);
          float flashward = 0.35 + 0.65 * pow(max(dot(dir, uFlashDirection), 0.0), 3.0);
          #if CLOUD_LAYERS > 1
          // The high layer: thin, pale and quick, over the low deck.
          vec2 high = cloudLayer(dir, 1.7, uCloudOffset * 1.9 + vec2(31.7, 12.3), uCloudCover * 0.6, 0.5);
          vec3 highColor = uCloudLit * (1.0 + 0.25 * sunward * uSunVisible);
          highColor += vec3(0.6, 0.65, 0.85) * uFlash * flashward;
          color = mix(color, mix(highColor, uHorizon, haze * 0.7), high.x * 0.55 * (1.0 - uCloudStorm));
          #endif
          vec2 low = cloudLayer(dir, 2.6, uCloudOffset, uCloudCover, height);
          // Two toon bands: the shaded body and the lit ragged edge, brighter toward the sun.
          float body = smoothstep(0.46, 0.54, low.y);
          vec3 lit = uCloudLit + uSunColor * 0.4 * sunward * uSunVisible * (1.0 - body);
          vec3 cloud = mix(lit, uCloudShade, body);
          cloud += vec3(0.75, 0.8, 1.0) * uFlash * flashward * (0.6 + 0.4 * body);
          color = mix(color, mix(cloud, uHorizon, haze * 0.75), low.x);
        }
        #endif
        color += vec3(0.5, 0.55, 0.7) * uFlash * 0.12;
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
