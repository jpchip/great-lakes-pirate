// Adds the forest canopy to a baked zone's shelter maps in place (plan 03 §14.4, Phase 2
// piece C), without the GDAL sources:
//
//   npm run geo:canopy                 # zone.apostles → public/world/apostles/wind/
//   npm run geo:canopy -- apostles
//
// A full `npm run geo:build` bakes the canopy in already (lib/wind.ts withCanopy). This tool
// is for a zone baked before that: it reads the published height tiles, raises forested land
// by the canopy (+15 m where the vegetation density map grows forest), and recomputes the
// lee over the zone. Raising land can only lengthen a lee, and the lee is the strongest
// shelter from any obstacle upwind, so the new shelter is the old one (which also counts
// obstacles past the zone edge, from the lake grid) or the canopy's, whichever is more.
// Funneling scales by (1 − new lee) / (1 − old lee), which is how the bake folds the lee in.
// Fetch and the land mask don't change: trees don't stop waves. Running it twice changes
// nothing the second time.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrid, type GridFormat } from '../../src/core/terrain-grid.ts';
import { CANOPY_M } from '../../src/sim/terrain/vegetation.ts';
import { encode, quantize } from './lib/encode.ts';
import { DIRECTIONS, poolCells, withCanopy } from './lib/wind.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const zoneName = process.argv[2] ?? 'apostles';
const dir = join(ROOT, 'public', 'world', zoneName);
const manifestPath = join(dir, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const t0 = performance.now();

// The sailing heightmap, from its tiles (they share their edge rows and columns).
const h = manifest.height;
const n: number = manifest.heightFormat.tileSamples;
const heights = new Float32Array(h.width * h.height);
for (let ty = 0; ty < h.tilesY; ty++) {
  for (let tx = 0; tx < h.tilesX; tx++) {
    const path = join(dir, h.tiles.replace('{tx}', String(tx)).replace('{ty}', String(ty)));
    const tile = decodeGrid(readFileSync(path), (n + 1) * (n + 1), n + 1, manifest.heightFormat);
    for (let j = 0; j <= n; j++) {
      heights.set(tile.subarray(j * (n + 1), (j + 1) * (n + 1)), (ty * n + j) * h.width + tx * n);
    }
  }
}
const grid = { width: h.width, height: h.height, step: h.step, x0: h.x0, z0: h.z0 };
const cells = poolCells(
  withCanopy({ width: h.width, height: h.height, data: heights }, grid),
  grid,
  manifest.wind.cellM,
);

const wind = manifest.wind;
if (cells.width !== wind.width || cells.height !== wind.height) {
  throw new Error(
    `canopy: cells ${cells.width}×${cells.height} don't match the wind maps ${wind.width}×${wind.height}`,
  );
}
const count = DIRECTIONS * wind.width * wind.height;
const read = (format: GridFormat & { file: string }): Float32Array =>
  decodeGrid(readFileSync(join(dir, format.file)), count, wind.width, format);
const shelter = read(wind.shelter);
const funnel = read(wind.funnel);

// The lee from the zone's own (canopy-raised) cells, as lib/wind.ts bakes it.
const cellM: number = wind.cellM;
const leeFactor: number = wind.leeFactor;
let maxTop = 0;
for (const v of cells.top) maxTop = Math.max(maxTop, v);
const leeReach = leeFactor * maxTop;
const step = cellM / 2;
const cellsN = cells.width * cells.height;
let raised = 0;
let sum = 0;
for (let k = 0; k < DIRECTIONS; k++) {
  const bearing = (k * 22.5 * Math.PI) / 180;
  const ux = Math.sin(bearing);
  const uz = -Math.cos(bearing);
  for (let j = 0; j < cells.height; j++) {
    for (let i = 0; i < cells.width; i++) {
      if (cells.land[j * cells.width + i]) continue;
      const x = (i + 0.5) * cellM;
      const z = (j + 0.5) * cellM;
      let lee = 0;
      for (let d = cellM; d <= leeReach; d += step) {
        const ci = Math.floor((x + ux * d) / cellM);
        const cj = Math.floor((z + uz * d) / cellM);
        if (ci < 0 || cj < 0 || ci >= cells.width || cj >= cells.height) break;
        const top = cells.top[cj * cells.width + ci] ?? 0;
        if (top > 0) lee = Math.max(lee, 1 - d / (leeFactor * top));
      }
      const idx = k * cellsN + j * cells.width + i;
      const old = shelter[idx] ?? 0;
      // Within half a quantization step it already is the canopy lee (a rerun).
      if (lee <= old + 0.5 / 255) continue;
      raised++;
      sum += lee - old;
      shelter[idx] = lee;
      funnel[idx] = old < 1 ? ((funnel[idx] ?? 0) * (1 - lee)) / (1 - old) : 0;
    }
  }
}

const q = (f: GridFormat) => ({ type: f.type, scale: f.scale, offset: f.offset });
writeFileSync(
  join(dir, wind.shelter.file),
  encode(quantize(shelter, q(wind.shelter)), wind.width, wind.shelter.encoding),
);
writeFileSync(
  join(dir, wind.funnel.file),
  encode(quantize(funnel, q(wind.funnel)), wind.width, wind.funnel.encoding),
);
manifest.wind = { ...wind, canopyM: CANOPY_M };
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const water = count - DIRECTIONS * cells.land.reduce((a, v) => a + v, 0);
console.log(
  `canopy: +${CANOPY_M} m on forest; shelter raised in ${raised} of ${water} water cells ` +
    `(${((100 * raised) / water).toFixed(1)}%), by ${(raised ? sum / raised : 0).toFixed(3)} on average; ` +
    `${((performance.now() - t0) / 1000).toFixed(1)} s`,
);
