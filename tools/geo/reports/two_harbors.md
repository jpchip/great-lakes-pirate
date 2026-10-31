# Two Harbors bake report

Written by `node tools/geo/build.ts`. Sizes are compressed bytes on disk.

- Zone: 3.07 × 3.07 km game, 24.6 × 24.6 km real (C = 8)
- Sailing heightmap: 769 × 769 samples every 4 m, 9 tiles, 373 KB; heights -243.3 m to 56.4 m
- Land heights: soft knee at 20 m (water depth stays 1:1)
- SDF and wind maps: 147 KB
- Island tiles (1 m): 0 KB
- Hand edits: setpiece.two_harbors (flatten, 90,860 samples), setpiece.two_harbors#cut1 (cut, 50,581 samples)
- Total: 523 KB

| Island | Found by | Land area (real km²) | Max height (m) | Land over 42° | Tiles |
| ------ | -------- | -------------------: | -------------: | ------------: | ----: |
