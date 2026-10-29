# Apostle Islands bake report

Written by `node tools/geo/build.ts`. Sizes are compressed bytes on disk.

- Zone: 7.17 × 8.19 km game, 57.3 × 65.5 km real (C = 8)
- Sailing heightmap: 1793 × 2049 samples every 4 m, 56 tiles, 2386 KB; heights -191.9 m to 52.0 m
- Land heights: soft knee at 20 m (water depth stays 1:1)
- SDF and wind maps: 1101 KB
- Island tiles (1 m): 6319 KB
- Hand edits: island.gull (rock, 755 samples), setpiece.bayfield (flatten, 81,023 samples), setpiece.ashland (flatten, 278,166 samples)
- Total: 9819 KB

| Island | Found by | Land area (real km²) | Max height (m) | Land over 42° | Tiles |
| ------ | -------- | -------------------: | -------------: | ------------: | ----: |
| Sand Island | component | 11.54 | 13.3 | 2.8% | 3×3 |
| Eagle Island | component | 0.1 | 5.8 | 27.1% | 1×1 |
| York Island | component | 1.11 | 9.8 | 9.6% | 2×2 |
| Raspberry Island | component | 1.2 | 17.7 | 14.9% | 2×2 |
| Oak Island | component | 20.27 | 42.5 | 7.6% | 4×4 |
| Bear Island | component | 7.39 | 30.5 | 4.5% | 2×3 |
| Devils Island | component | 1.3 | 13.3 | 8.6% | 1×2 |
| Otter Island | component | 5.42 | 23.3 | 4.3% | 3×2 |
| Rocky Island | component | 4.24 | 18 | 6.7% | 3×3 |
| South Twin Island | component | 1.36 | 10.9 | 6.6% | 2×2 |
| North Twin Island | component | 0.71 | 10.4 | 12.4% | 1×2 |
| Manitou Island | component | 5.39 | 22.3 | 5.6% | 3×3 |
| Ironwood Island | component | 2.71 | 16.1 | 5.2% | 2×2 |
| Cat Island | component | 5.45 | 16.7 | 5.1% | 2×3 |
| Outer Island | component | 31.2 | 32.5 | 3.5% | 4×6 |
| Stockton Island | component | 39.38 | 27.9 | 3.9% | 6×4 |
| Gull Island | component | 0.04 | 5.9 | 15.2% | 1×1 |
| Michigan Island | component | 5.99 | 17.8 | 7.7% | 3×3 |
| Hermit Island | component | 3.17 | 26.2 | 6.3% | 2×2 |
| Basswood Island | component | 7.81 | 27.1 | 8.1% | 3×3 |
| Madeline Island | component | 58.2 | 27.8 | 4% | 9×8 |
| Long Island | bounds | 2.45 | 2.6 | 5.2% | 8×5 |
