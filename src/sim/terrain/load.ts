import { decodeGrid } from '../../core/terrain-grid';
import { GridField } from './grid-field';
import { zoneManifestSchema, type ZoneManifest } from './manifest';
import { WindMaps, ZoneTerrain } from './zone-terrain';

/**
 * Loads a whole baked coastal zone (plan 03 §8.3; format in tools/geo/README.md): all of
 * its sailing heightmap tiles at full resolution, the shoreline SDF and the wind maps,
 * plus the coarser grids the renderer and the water draw from. Gameplay can then query
 * anywhere in the zone with no loading while sailing; what streams by distance is the
 * terrain meshes (render/terrain). For the Apostles that's 3.5 MB on the wire and about
 * 50 MB decoded, the top of plan 03 §8.4's 30–50 MB terrain estimate.
 */

/** Reads a file of the zone by its path relative to the zone folder. */
export type FetchBytes = (path: string) => Promise<Uint8Array>;

export interface LoadedZone {
  manifest: ZoneManifest;
  terrain: ZoneTerrain;
  /** Heights for the whole zone every `BACKDROP_STRIDE` samples, for rendering only. */
  backdrop: GridField;
  /**
   * Heights and the shoreline SDF for the whole zone every `WATER_STRIDE` samples, for
   * the water's depth bands and shore foam out to the far islands (plan 04 §7).
   */
  seabed: GridField;
  shoreline: GridField;
}

/** Backdrop spacing in heightmap samples (32 m at the 4 m sailing grid). */
export const BACKDROP_STRIDE = 8;
/** Water-look spacing in heightmap samples (8 m). */
export const WATER_STRIDE = 2;

/** Every `stride`-th sample of a grid, keeping its frame. */
export function subsample(field: GridField, stride: number): GridField {
  const width = Math.floor((field.width - 1) / stride) + 1;
  const height = Math.floor((field.height - 1) / stride) + 1;
  const values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) values[j * width + i] = field.at(i * stride, j * stride);
  }
  return new GridField(field.x0, field.z0, field.step * stride, width, height, values);
}

/** `fetch` relative to a zone folder URL, e.g. `new URL('world/apostles/', baseURI)`. */
export function httpBytes(zoneUrl: URL): FetchBytes {
  return async (path) => {
    const response = await fetch(new URL(path, zoneUrl));
    if (!response.ok) throw new Error(`terrain: ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}

export async function loadZoneTerrain(read: FetchBytes): Promise<LoadedZone> {
  const manifest = zoneManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(await read('manifest.json'))),
  );
  const { height: h, heightFormat, sdf, wind } = manifest;
  const n = heightFormat.tileSamples;
  if (h.tilesX * n + 1 !== h.width || h.tilesY * n + 1 !== h.height) {
    throw new RangeError(
      `terrain: ${h.tilesX}×${h.tilesY} tiles don't make ${h.width}×${h.height}`,
    );
  }

  // Tiles share their edge row and column, so k tiles are k·n + 1 samples.
  const heights = new Float32Array(h.width * h.height);
  const tileJobs: Promise<void>[] = [];
  for (let ty = 0; ty < h.tilesY; ty++) {
    for (let tx = 0; tx < h.tilesX; tx++) {
      const path = h.tiles.replace('{tx}', String(tx)).replace('{ty}', String(ty));
      tileJobs.push(
        read(path).then((bytes) => {
          const tile = decodeGrid(bytes, (n + 1) * (n + 1), n + 1, heightFormat);
          for (let j = 0; j <= n; j++) {
            heights.set(
              tile.subarray(j * (n + 1), (j + 1) * (n + 1)),
              (ty * n + j) * h.width + tx * n,
            );
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

  const cells = wind.width * wind.height;
  const windLayers = async (format: ZoneManifest['wind']['shelter']): Promise<GridField[]> => {
    const all = decodeGrid(await read(format.file), wind.directions * cells, wind.width, format);
    const layers: GridField[] = [];
    for (let k = 0; k < wind.directions; k++) {
      layers.push(
        new GridField(
          wind.x0 + wind.cellM / 2,
          wind.z0 + wind.cellM / 2,
          wind.cellM,
          wind.width,
          wind.height,
          all.subarray(k * cells, (k + 1) * cells),
        ),
      );
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

  const height = new GridField(h.x0, h.z0, h.step, h.width, h.height, heights);
  const terrain = new ZoneTerrain(
    manifest.zone,
    height,
    sdfField,
    new WindMaps(shelter, fetchMaps, funnel),
  );
  return {
    manifest,
    terrain,
    backdrop: subsample(height, BACKDROP_STRIDE),
    seabed: subsample(height, WATER_STRIDE),
    shoreline: subsample(sdfField, WATER_STRIDE),
  };
}
