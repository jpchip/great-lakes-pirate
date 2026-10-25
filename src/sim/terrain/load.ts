import { decodeGrid } from '../../core/terrain-grid';
import { GridField } from './grid-field';
import { zoneManifestSchema, type ZoneManifest } from './manifest';
import { WindMaps, ZoneTerrain } from './zone-terrain';

/**
 * Loads a slice of a baked coastal zone (plan 03 §8.3; format in tools/geo/README.md):
 * the sailing heightmap tiles in the slice at full resolution, the SDF and wind maps
 * cropped to it, and a coarse backdrop of the whole zone so land past the slice still
 * shows through the fog. Phase 1 loads one slice up front; tile streaming comes in Phase 2.
 */

/** Reads a file of the zone by its path relative to the zone folder. */
export type FetchBytes = (path: string) => Promise<Uint8Array>;

/** Inclusive range of sailing tiles. */
export interface TileRange {
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

export interface LoadedZone {
  manifest: ZoneManifest;
  terrain: ZoneTerrain;
  /** Heights for the whole zone every `BACKDROP_STRIDE` samples, for rendering only. */
  backdrop: GridField;
  tiles: TileRange;
}

/** Backdrop spacing in heightmap samples (32 m at the 4 m sailing grid). */
export const BACKDROP_STRIDE = 8;

/** `fetch` relative to a zone folder URL, e.g. `new URL('world/apostles/', baseURI)`. */
export function httpBytes(zoneUrl: URL): FetchBytes {
  return async (path) => {
    const response = await fetch(new URL(path, zoneUrl));
    if (!response.ok) throw new Error(`terrain: ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

export async function loadZoneTerrain(read: FetchBytes, tiles: TileRange): Promise<LoadedZone> {
  const manifest = zoneManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(await read('manifest.json'))),
  );
  const { height: h, heightFormat, sdf, wind } = manifest;
  const n = heightFormat.tileSamples;
  if (
    tiles.tx0 < 0 ||
    tiles.ty0 < 0 ||
    tiles.tx1 >= h.tilesX ||
    tiles.ty1 >= h.tilesY ||
    tiles.tx0 > tiles.tx1 ||
    tiles.ty0 > tiles.ty1
  ) {
    throw new RangeError(`terrain: tile range outside the ${h.tilesX}×${h.tilesY} zone`);
  }

  // Slice heights: tiles share their edge row and column, so k tiles are k·n + 1 samples.
  const sliceW = (tiles.tx1 - tiles.tx0 + 1) * n + 1;
  const sliceH = (tiles.ty1 - tiles.ty0 + 1) * n + 1;
  const slice = new Float32Array(sliceW * sliceH);
  const backW = Math.floor((h.width - 1) / BACKDROP_STRIDE) + 1;
  const backH = Math.floor((h.height - 1) / BACKDROP_STRIDE) + 1;
  const back = new Float32Array(backW * backH);

  const tileJobs: Promise<void>[] = [];
  for (let ty = 0; ty < h.tilesY; ty++) {
    for (let tx = 0; tx < h.tilesX; tx++) {
      const path = h.tiles.replace('{tx}', String(tx)).replace('{ty}', String(ty));
      tileJobs.push(
        read(path).then((bytes) => {
          const tile = decodeGrid(bytes, (n + 1) * (n + 1), n + 1, heightFormat);
          // The tile's samples on the backdrop grid.
          const gi0 = tx * n;
          const gj0 = ty * n;
          for (
            let j = Math.ceil(gj0 / BACKDROP_STRIDE) * BACKDROP_STRIDE;
            j <= gj0 + n;
            j += BACKDROP_STRIDE
          ) {
            for (
              let i = Math.ceil(gi0 / BACKDROP_STRIDE) * BACKDROP_STRIDE;
              i <= gi0 + n;
              i += BACKDROP_STRIDE
            ) {
              back[(j / BACKDROP_STRIDE) * backW + i / BACKDROP_STRIDE] =
                tile[(j - gj0) * (n + 1) + (i - gi0)] ?? 0;
            }
          }
          if (tx < tiles.tx0 || tx > tiles.tx1 || ty < tiles.ty0 || ty > tiles.ty1) return;
          const si0 = (tx - tiles.tx0) * n;
          const sj0 = (ty - tiles.ty0) * n;
          for (let j = 0; j <= n; j++) {
            slice.set(tile.subarray(j * (n + 1), (j + 1) * (n + 1)), (sj0 + j) * sliceW + si0);
          }
        }),
      );
    }
  }

  const sdfJob = read(sdf.file).then(
    (bytes) =>
      new GridField(
        sdf.x0,
        sdf.z0,
        sdf.step,
        sdf.width,
        sdf.height,
        decodeGrid(bytes, sdf.width * sdf.height, sdf.width, sdf),
      ),
  );

  // Wind cells covering the slice, plus one on each side for bilinear sampling.
  const x0 = h.x0 + tiles.tx0 * n * h.step;
  const z0 = h.z0 + tiles.ty0 * n * h.step;
  const x1 = x0 + (sliceW - 1) * h.step;
  const z1 = z0 + (sliceH - 1) * h.step;
  const ci0 = Math.max(0, Math.floor((x0 - wind.x0) / wind.cellM) - 1);
  const cj0 = Math.max(0, Math.floor((z0 - wind.z0) / wind.cellM) - 1);
  const ci1 = Math.min(wind.width - 1, Math.ceil((x1 - wind.x0) / wind.cellM) + 1);
  const cj1 = Math.min(wind.height - 1, Math.ceil((z1 - wind.z0) / wind.cellM) + 1);
  const cells = wind.width * wind.height;
  const windLayers = async (format: ZoneManifest['wind']['shelter']): Promise<GridField[]> => {
    const all = decodeGrid(await read(format.file), wind.directions * cells, wind.width, format);
    const layers: GridField[] = [];
    for (let k = 0; k < wind.directions; k++) {
      const layer = new GridField(
        wind.x0 + wind.cellM / 2,
        wind.z0 + wind.cellM / 2,
        wind.cellM,
        wind.width,
        wind.height,
        all.subarray(k * cells, (k + 1) * cells),
      );
      layers.push(layer.crop(ci0, cj0, ci1 - ci0 + 1, cj1 - cj0 + 1));
    }
    return layers;
  };

  const [sdfField, shelter, fetchMaps, funnel] = await Promise.all([
    sdfJob,
    windLayers(wind.shelter),
    windLayers(wind.fetch),
    windLayers(wind.funnel),
    ...tileJobs,
  ]);

  const height = new GridField(x0, z0, h.step, sliceW, sliceH, slice);
  const si0 = Math.round((x0 - sdf.x0) / sdf.step);
  const sj0 = Math.round((z0 - sdf.z0) / sdf.step);
  const terrain = new ZoneTerrain(
    manifest.zone,
    height,
    sdfField.crop(si0, sj0, sliceW, sliceH),
    new WindMaps(shelter, fetchMaps, funnel),
  );
  const backdrop = new GridField(h.x0, h.z0, h.step * BACKDROP_STRIDE, backW, backH, back);
  return { manifest, terrain, backdrop, tiles };
}
