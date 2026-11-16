# Siskiwit Bay bake report

Written by `node tools/geo/build.ts`. Sizes are compressed bytes on disk.

- Zone: 3.07 × 3.07 km game, 24.6 × 24.6 km real (C = 8)
- Sailing heightmap: 769 × 769 samples every 4 m, 9 tiles, 345 KB; heights -157.4 m to 48.6 m
- Land heights: soft knee at 20 m (water depth stays 1:1)
- SDF and wind maps: 167 KB
- Island tiles (1 m): 164 KB
- Hand edits: setpiece.siskiwit (flatten, 24,155 samples)
- Total: 679 KB

| Island | Found by | Land area (real km²) | Max height (m) | Land over 42° | Tiles |
| ------ | -------- | -------------------: | -------------: | ------------: | ----: |
| Siskiwit logging camp | bounds | 1.94 | 22.1 | 7.2% | 2×2 |
