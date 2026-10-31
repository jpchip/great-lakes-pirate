# Twin Ports bake report

Written by `node tools/geo/build.ts`. Sizes are compressed bytes on disk.

- Zone: 4.10 × 4.10 km game, 32.8 × 32.8 km real (C = 8)
- Sailing heightmap: 1025 × 1025 samples every 4 m, 16 tiles, 767 KB; heights -97.4 m to 53.9 m
- Land heights: soft knee at 20 m (water depth stays 1:1)
- SDF and wind maps: 307 KB
- Island tiles (1 m): 0 KB
- Hand edits: setpiece.duluth_canal (flatten, 23,608 samples), setpiece.duluth_canal#cut1 (cut, 9,282 samples), setpiece.duluth (flatten, 81,398 samples), setpiece.superior_entry (flatten, 37,434 samples), setpiece.superior_entry#cut1 (cut, 50,154 samples), setpiece.superior_entry#cut2 (cut, 385 samples), setpiece.superior (flatten, 69,464 samples)
- Total: 1077 KB

| Island | Found by | Land area (real km²) | Max height (m) | Land over 42° | Tiles |
| ------ | -------- | -------------------: | -------------: | ------------: | ----: |
