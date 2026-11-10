# Docks districts: the kit, the editor and the bake

Phase 7 piece C (plan 08 §13, §15, §20.4). A docks district is its own on-foot scene built
from one modular kit, stored as a placement list and baked offline for its ground and the
guards' navmesh.

## Files

| What                                                                                   | Where                                                |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The kit: every piece's size, collider, surface, light and climb                        | `data/kit.json` (schema `data/schemas/districts.ts`) |
| Districts: port, harbor, layout file, origin on the harbor's set piece, gangway        | `data/districts.json`                                |
| A layout, as the editor saves it                                                       | `data/districts/<id>.json`                           |
| Baked ground (1 m, int16 cm, Git LFS) and navmesh                                      | `public/districts/<bake>/ground.bin`, `navmesh.json` |
| Bake report                                                                            | `tools/district/reports/<bake>.md`                   |
| Layout format and edits (pure)                                                         | `src/sim/district/layout.ts`, `kit.ts`               |
| Navmesh queries: nearest polygon, A*, funnel, door links (pure)                        | `src/sim/district/navmesh.ts`                        |
| The district built from a layout: colliders with surfaces, lamps, doors, climbs, marks | `src/gameplay/district/district.ts`                  |
| Ground, frames to and from the zone                                                    | `src/gameplay/district/ground.ts`                    |
| Drawing the kit: merged 32 m blocks, roofs per building, lamp pools                    | `src/render/district/`                               |
| Dev page and placement editor                                                          | `district.html`, `src/debug/district/`               |

## The layout format

Plan 09 §4's grid: 2 m cells. Local meters, x along the shore, z inland, so the lake is
toward -z and a heading of 0 faces it.

- **cells** `[palette, col, row, variant]`: pier decks, the crib wharf, floors, boardwalk, track, gravel.
- **edges** `[palette, col, row, side, variant]`, side 0 the north edge, 3 the west: fences, railings, ladders, partitions inside buildings.
- **props** `[palette, x, z, yawDeg, variant]` on a 0.25 m grid in 15° turns.
- **buildings**: a rectangle of cells, a wall and floor piece, eaves height, roof (gable, flat or false front), paint, the port tab its door opens by day, and perimeter overrides `[piece, side, index]` for doors and windows.
- **marks**: gangways, berths, guard posts, patrol points, loot, exits and crowd spots, for pieces A, D, E, F and G.

## Working on a district

1. `npm run dev`, then open `/district.html` (`?hour=22`, `?fog=1`, `?guards=12`, `?edit=1`).
2. Walk it: WASD, Shift, C, Space. T and Shift+T change the hour, N shows the navmesh, G
   starts 12 test guards walking it, O toggles fog, Tab switches to the editor.
3. Edit: pick a piece in the palette, LMB places (drag to paint cells and edges), R and
   Shift+R turn a prop, X deletes under the cursor, Q picks the piece under it, Ctrl+Z and
   Ctrl+Y undo and redo, Ctrl+S saves. "Building" drags out a new building; click one with
   Select to edit it, and lay a door or window piece on its wall to swap that panel.
4. **Save** writes `data/districts/<id>.json` (schema-checked, prettier-formatted). **Bake**
   runs `npm run district:bake` for that district and reloads the navmesh. The HUD says
   when the navmesh is stale, and `tests/district.test.ts` fails until it's rebaked.

`npm run district:bake` needs the zone tiles from Git LFS. `npm run bench:docks` runs
Bayfield at night with 12 guards and checks the draw-call budget (≤ 200).

## Notes for the next pieces

- **Going ashore (A):** `buildDistrict(layout, decodeGround(bytes))` is an `OnFootZone`.
  Spawn at `model.mark(def.gangway)`; `districtFrame` maps district meters to the zone.
- **Perception and guards (D):** `model.lamps` (position, radius, intensity, color) are the
  pools of light; colliders carry `blocksSight: false` for railings, bars and posts.
  `NavMesh.findPath(from, to, { closedDoors })` treats a shut or locked door as a missing link.
- **Theft (E), the saloon (F), the lockup (G):** door ids are `<building>.door<n>` in
  perimeter order (north, east, south, west); `model.surfaceAt` gives footstep surfaces;
  the `loot`, `post` and `patrol` marks are placeholders to move in the editor.
