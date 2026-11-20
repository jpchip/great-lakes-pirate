import { ICE_LUT_CM, ICE_LUT_SIZE } from '../../sim/ice/zone-ice';

/**
 * The ice sheet in the water shader (plan 04 §8.3; plan 11 §18.4 piece L): a masked layer
 * over the water from the zone's shelter texture and the day's lookup strip (sim/ice/
 * zone-ice), so the sheet is piece K's ice cell for cell. The 1 km shelter cells are too
 * coarse to draw as they are, so the shader breaks them up:
 *
 * - **The edge** wanders by two octaves of noise, and water near the shore (the shore
 *   texture's distance) freezes a little ahead of its cell, so ice hugs the shore first.
 * - **Pack and new ice** are plates on a cellular noise: a plate is there when its cell's
 *   hash is under the local cover, so loose pack is scattered plates with leads of open
 *   water between, and new ice is dark nilas with pale pancake rims.
 * - **Fast ice** is a whole sheet with long cracks along bigger cells, snow drifted across
 *   it by the snow on the ground, and blue-black clear ice where the wind has swept it.
 * - **Floes** at the break-up are small rounded plates far out; near the camera the
 *   instanced floes (floes.ts) take over.
 *
 * Everything sits inside `if (uIceOn > 0.5)` and a cover test, so open summer water pays
 * one uniform branch.
 */

export const iceUniformsChunk = /* glsl */ `
uniform float uIceOn;
uniform sampler2D uIceShelter;
uniform vec4 uIceShelterRect;
uniform sampler2D uIceLut;
uniform vec3 uIceColor;
uniform vec3 uIceDarkColor;
uniform vec3 uIceSnowColor;
uniform vec3 uIceCrackColor;
uniform float uIceSnow;
uniform float uFloeNear;
`;

/** `iceCells` and `shadeIce`; needs `hash` and `valueNoise` (wave-glsl noiseChunk). */
export const iceShadeChunk = /* glsl */ `
// Cellular noise: x the distance to the nearest feature point, y the gap to the second
// (small near a cell border, so a crack or a lead), z the nearest cell's hash.
vec3 iceCells(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash(i + g), hash(i + g + 17.3));
      vec2 r = g + 0.15 + 0.7 * o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash(i + g + 41.7);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec3(sqrt(d1), sqrt(d2) - sqrt(d1), id);
}

// The ice over the water color at p (zone meters), dist from the camera, toShore from the
// shore texture (meters, negative on land), footprint the pixel's size in meters. Returns
// the color and how much of the pixel is ice in w (the wake and spray read nothing).
vec4 shadeIce(vec3 water, vec2 p, float dist, float toShore, float footprint, vec3 toCamera) {
  float shelter = texture2D(uIceShelter, (p - uIceShelterRect.xy) * uIceShelterRect.zw).r;
  // Water by the shore freezes ahead of its cell: shore ice first.
  if (uShoreOn > 0.5) shelter += 0.1 * (1.0 - smoothstep(0.0, 120.0, toShore));
  shelter = clamp(shelter, 0.0, 1.0);
  vec4 day = texture2D(uIceLut, vec2(shelter * ${((ICE_LUT_SIZE - 1) / ICE_LUT_SIZE).toFixed(6)} + ${(0.5 / ICE_LUT_SIZE).toFixed(6)}, 0.5));
  float sheet = day.r;
  float floes = day.b;
  if (sheet < 0.01 && floes < 0.01) return vec4(water, 0.0);
  float thick = day.g * ${ICE_LUT_CM.toFixed(1)};
  float fast = day.a;

  // The edge wanders: big lobes and smaller tongues, more where the cover is partial.
  float wob = (valueNoise(p / 160.0) - 0.5) + 0.5 * (valueNoise(p / 47.0) - 0.5);
  float fine = 1.0 - smoothstep(2.0, 8.0, footprint);

  vec3 color = water;
  float ice = 0.0;
  if (sheet >= 0.01) {
    float cover = clamp(sheet + wob * 0.55 * smoothstep(0.0, 0.25, sheet) * (1.0 - 0.7 * fast), 0.0, 1.0);
    // Plates: pack about 22 m across, a fast sheet's cracks on cells of about 70 m.
    // A closed sheet is whole (and skips the plates' cellular noise, most of the winter's
    // pixels); anything less is plates, so the edge breaks up into floes and leads rather
    // than smooth blots.
    float closed = step(0.97, sheet);
    vec3 c = closed > 0.5 ? vec3(0.5, 1.0, 0.0) : iceCells(p / 22.0);
    float lead = (1.0 - cover) * 0.35;
    float plate = step(c.z, cover * 1.08 - 0.04) * smoothstep(lead, lead + 0.03, c.y);
    plate = max(plate, closed);
    // Thin ice is dark and lets the water show; it whitens as it thickens.
    float grown = smoothstep(2.0, 14.0, thick);
    vec3 base = mix(mix(water, uIceDarkColor, 0.65), uIceColor, grown);
    // New ice: pale pancake rims at the plate edges.
    float rim = (1.0 - grown) * (1.0 - smoothstep(0.03, 0.09, c.y)) * fine;
    base = mix(base, uIceColor, rim * 0.6);
    // Snow on ice firm enough to hold it, in drifts across the sheet.
    // Long drifts across the wind, with swept patches of clear ice between them.
    float drift = valueNoise(p * vec2(1.0 / 90.0, 1.0 / 26.0)) * 0.65 + valueNoise(p / 17.0) * 0.35;
    float swept = 1.0 - smoothstep(0.28, 0.42, drift);
    float snow = uIceSnow * smoothstep(4.0, 12.0, thick);
    snow *= mix(0.85, 1.0, smoothstep(0.5, 0.75, drift)) * (1.0 - 0.8 * swept);
    vec3 top = mix(base, uIceSnowColor, snow);
    // Fast ice: long cracks, a pale ridge of snow beside the dark line.
    if (fast > 0.5) {
      // Cracks: thin lines on some cell borders only, a few tens of centimeters wide.
      // Warped, so the cracks wander instead of drawing a tiling.
      vec2 warp = vec2(valueNoise(p / 37.0), valueNoise(p / 37.0 + 19.1)) - 0.5;
      vec3 big = iceCells((p + warp * 40.0) / 110.0 + 3.1);
      float widthM = max(0.1, footprint * 0.6);
      float gapM = big.y * 110.0;
      float some = smoothstep(0.55, 0.7, valueNoise(p / 70.0 + big.z * 7.0));
      float crack = (1.0 - smoothstep(widthM, widthM * 2.0, gapM)) * some;
      // Snow drifted into the crack's lee: a pale ridge beside it.
      float ridge = (1.0 - smoothstep(widthM * 2.0, widthM * 6.0, gapM)) * some * snow * fine;
      top = mix(top, uIceSnowColor * 1.05, ridge * 0.35);
      top = mix(top, mix(uIceCrackColor, uIceColor, 0.45 * snow), crack * 0.7);
    }
    if (closed < 0.5) {
      // Loose plates' own edges, lightly, and a darker wet rim where they meet the water.
      top = mix(top, uIceCrackColor, (1.0 - smoothstep(lead, lead + 0.05, c.y)) * 0.45 * grown * fine);
    }
    // Clear ice catches the sun; snow doesn't.
    vec3 halfway = normalize(uSunDirection + toCamera);
    float glint = step(0.6, pow(max(halfway.y, 0.0), 90.0)) * (1.0 - snow) * grown;
    top += uSunColor * glint * 0.5;
    // The sky's tint at a grazing look, so far ice meets the horizon.
    top = mix(top, uSkyColor, 0.25 * (1.0 - smoothstep(0.05, 0.35, toCamera.y)));
    color = mix(color, top, plate);
    ice = plate;
  }
  // Floes at the break-up, small and rounded, drawn far out; the meshes take the near ones.
  if (floes >= 0.01) {
    float far = smoothstep(uFloeNear * 0.55, uFloeNear, dist);
    if (far > 0.0) {
      vec3 c = iceCells(p / 9.0 + 7.7);
      float cover = clamp(floes + wob * 0.3, 0.0, 1.0);
      float floe = step(c.z, cover) * smoothstep(0.1, 0.16, c.y) * far;
      vec3 top = mix(uIceColor, uIceSnowColor, 0.5 + 0.5 * uIceSnow);
      top = mix(top, uIceCrackColor, (1.0 - smoothstep(0.16, 0.24, c.y)) * 0.4 * fine);
      top = mix(top, uSkyColor, 0.25 * (1.0 - smoothstep(0.05, 0.35, toCamera.y)));
      color = mix(color, top, floe);
      ice = max(ice, floe);
    }
  }
  return vec4(color, ice);
}
`;
