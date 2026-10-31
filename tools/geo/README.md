# Geo pipeline

Bakes a coastal zone's terrain from public US government data (plan 03 §8, spike S3):

```sh
npm run geo:build                 # zone.apostles in data/zones.json → public/world/apostles/
npm run geo:build -- twin_ports   # any zone by its id without the prefix (twin_ports, two_harbors)
npm run geo:build -- apostles --compare            # also compare tile formats
npm run geo:build -- apostles --land-curve=none    # try another land height curve
npm run geo:build -- apostles --refetch            # re-download and re-warp the sources
npm run geo:canopy                # add the forest canopy to an existing bake's shelter maps
npm run geo:chart                 # the chart's coast, islands, depths and soundings → data/chart-coast.json
```

It runs locally, not in CI (plan 01 §11). The baked files are committed through Git LFS.

The zone's settings and set pieces come from `data/zones.json`, and its islands from
`data/islands.json` (schemas in `data/schemas/`).

## Requirements

- Node 22.18+ (runs the TypeScript directly).
- GDAL 3.4+ command-line tools (`gdalwarp`, `gdal_translate`), `curl` and `tar` on the PATH.
  Ubuntu: `sudo apt install gdal-bin`. macOS: `brew install gdal`.
- Network on the first run: `www.ngdc.noaa.gov` (bathymetry, ~100 MB) and
  `prd-tnm.s3.amazonaws.com` (DEM, read in place, only the blocks the zone needs).

Sources and warped rasters are cached in `tools/geo/.cache/` (gitignored; for the
Apostles, ~1.2 GB). A cached rebuild takes about 35 seconds.

## Sources

| Data                                                                    | Source                                                                    | License          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| Lake Superior bathymetry, 3 arc-second (~90 m), includes nearshore land | NOAA NCEI Great Lakes Bathymetry                                          | Public domain    |
| Land elevation, 1/3 arc-second (~10 m), lake hydroflattened             | USGS 3DEP seamless DEM                                                    | Public domain    |
| Island center points (to name the land components)                      | OpenStreetMap via Nominatim, looked up once and stored in the zone config | ODbL; facts only |

## What it does

1. Warps both sources onto the zone grid in the game's chart projection (the local
   equirectangular projection in `src/core/coords.ts`), at 1 game meter (8 real meters).
2. Merges them: land from the DEM, depth from the bathymetry, 0 = mean lake level
   (183.5 m). A land height curve can trade height for walkability (see below).
3. Applies the hand-edit layer (`lib/edits.ts`): flattens the land in each set piece's
   footprint, dredges its cuts, and raises rocks for islands too small for the data (Gull Island).
4. Downsamples to the 4 m sailing grid and cuts it into 257 × 257 tiles (256 plus a shared
   edge).
5. Bakes the shoreline signed distance field, and shelter, fetch and funneling maps for 16
   wind directions on 32 m cells. Shelter counts a 15 m canopy on forested land, from the
   runtime's vegetation density map (`src/sim/terrain/vegetation.ts`). Rays that leave the zone continue on a 1 km lake-wide grid,
   so fetch from the open lake is real.
6. Finds each named island's land component, and cuts 1 m on-foot tiles for its footprint
   plus a 64 m margin.
7. Writes `manifest.json` (with the hand edits it applied), a report (`reports/<zone>.md`) and preview images.

## The chart bake

`npm run geo:chart` (`chart.ts`, `lib/coast.ts`) bakes the chart mode's geography for the
whole western lake from the same two sources (plan 03 §8.2 step 9, §22):

1. Warps the DEM (averaged) and the bathymetry onto 50 m cells of the chart projection over
   92.35°W–89.9°W, 46.4°N–47.85°N. The first run reads about 4 minutes of DEM blocks into
   `.cache/chart/`; a cached rebuild takes about 5 seconds.
2. Land is the DEM at least 0.5 m above lake level; water depth comes from the bathymetry.
   A flood fill from open water keeps only the lake, so inland lakes become land, and land
   smaller than 0.75 ha sinks.
3. Traces the shoreline with marching squares (the lake is one clockwise ring, islands are
   counter-clockwise) and simplifies it at 40 m, tightening any ring that would cross
   another.
4. Traces depth contours at 3, 10 and 30 fathoms, and samples soundings on a 1 nm grid away
   from the shore.
5. Names islands from `data/islands.json` (plus a short list in `chart.ts`, e.g. Minnesota
   Point) and writes `data/chart-coast.json`, `reports/chart.md` and `reports/chart-relief.png`.

The runtime merges it with the hand-authored `data/chart.json` in
`src/sim/chart/chart-data.ts`. Don't edit `chart-coast.json` by hand; rerun the bake.

## Output format

`public/world/<zone>/manifest.json` describes everything. Every grid file is row-major,
little-endian, zlib-compressed, with no header; `value = raw × scale + offset`.
`src/core/terrain-grid.ts` decodes them (`decodeGrid`).

| File                         | Grid             | Type                    | Notes                              |
| ---------------------------- | ---------------- | ----------------------- | ---------------------------------- |
| `height/{tx}-{ty}.bin`       | 257², 4 m        | u16, 1/64 m from −512 m | `delta-deflate`                    |
| `islands/<id>/{tx}-{ty}.bin` | 257², 1 m        | same                    | per island, origin in the manifest |
| `sdf.bin`                    | whole zone, 4 m  | i16, 0.25 m             | positive over water                |
| `wind/shelter.bin`           | 16 × cells, 32 m | u8, 0–1                 | layer k = wind from k × 22.5°      |
| `wind/fetch.bin`             | 16 × cells       | u16, 10 m               | real meters of open water upwind   |
| `wind/funnel.bin`            | 16 × cells       | u8, 0–1                 | channel speed-up strength          |

`delta-deflate` stores each row as differences from the previous sample, low bytes then high
bytes. It came out 8% smaller than a 16-bit PNG and 46% smaller than plain deflate, and
avoids the browser's 8-bit canvas when decoding PNGs.

## Tuning

- **Land height curve** (`landCurve` in the zone config): squeezing the map 8× sideways
  makes 1:1 slopes 8× steeper. `soft-knee` keeps low ground near 1:1 and flattens hills;
  `linear` scales everything. The report lists each island's share of land over the 42° walk
  limit.
- **Lee length** is 15× the obstacle height in game meters (`DEFAULT_WIND` in `lib/wind.ts`).
- **Funneling** starts in channels narrower than 8 km real, full strength at 1.5 km.
- **Islands** joined to the mainland in the data need a `clip` box in `data/islands.json`
  (Long Island); one too small to show up gets a `rock` (Gull Island).
- **Set-piece footprints** (`setPieces` in `data/zones.json`): a rectangle anchored on the
  shore at `at`, facing `bearingDeg` out over the water, `inlandM` deep behind the anchor,
  `seawardM` out in front and `alongM` wide. Land inside is flattened to `groundM`, blending
  back over `blendM`; water inside is left as it is.
- **Cuts** (`cuts` on a set piece): a channel from `from` to `to`, `widthM` wide, dredged
  to at least `depthM`, with banks blending back over `blendM`. They only lower the
  ground, after the footprint is flattened. The Duluth Ship Canal and Superior Entry are
  cuts at their real widths through the compressed points; Agate Bay's is a basin.
