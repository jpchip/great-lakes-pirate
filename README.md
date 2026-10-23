# Great Lakes Pirate

**The Caribbean had Blackbeard. Lake Superior had “Roaring” Dan Seavey—and now it has you.**

It’s spring 1900. Ore freighters choke the Duluth ship canal. Lighthouses sweep the Apostle Islands. Revenue cutters prowl the lanes while Hollister Fish & Packing counts every crate in the warehouse. You’re nobody—yet—with a small schooner, a ledger that looks honest, and a knack for being somewhere else when the sun comes up.

By day you haul grain, lumber, and fish like any captain trying to eat. By night you slip through the docks district: steal cargo, fence goods, sabotage a rival’s rigging, vanish before the watch bell. At sea you chase fall gales for the richest runs, duck patrols, intimidate steamers into surrender, or explore sea caves and wrecks the charts don’t bother to name. Build hideouts on remote islands—grid by grid—stash contraband, craft, customize. Grow **Fame** so fences and contacts open up; grow **Wanted** and the lake gets smaller, meaner, and more personal.

This is an **open sandbox**: no scripted hero’s journey. Go fully legit (harder margins, no heat), go full outlaw, or live in the grey between. Violence pays—but it brings heat you may not survive. Permadeath is real. The lakes are real. The tall tales are yours to write.

_Sid Meier’s Pirates!_ meets _Sea of Thieves_ meets a grid base-builder—set on western Lake Superior instead of the Spanish Main, with a stealth layer in the port at night and seasons that can freeze the lake solid under your keel.

---

## What you’ll do

| Rhythm               | What happens                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Day (port)**       | Trade, contracts, upgrades, rumors, harbor fees—the respectable face                                    |
| **Night (docks)**    | Stealth, theft, fencing, sabotage—the shadow face                                                       |
| **At sea**           | Arcade sailing with wind and weather, chart travel across open water, ambushes, exploration, evasion    |
| **Ashore (islands)** | Walk forests and cliffs, poach, raid lighthouses, discover secrets, expand hideouts                     |
| **Winter**           | Risky ice sailing, smuggling on frozen routes, warehouse jobs, hideout projects—or skip ahead to spring |

Long-term vision: all five Great Lakes, real geography compressed into a believable playground, grounded in 1900 industry (ore, grain, lumber, fishing, brownstone quarries) with legend layered on top—moon-cussing wrecks, venison poaching, whiskey-fueled hijacks—without turning real communities into targets.

---

## Design pillars

1. **Big lakes, real feel** — Hybrid scale: detailed coasts and islands, abstracted open-water crossings with random encounters.
2. **Two faces** — Honest trader by day, pirate by night; your mix is your story.
3. **Consequences** — Separate **Fame** and **Wanted**; optional violence; regional heat; jail, bail, jailbreak, and high-stakes capture.
4. **Hideouts are yours** — Multiple grid-based bases for storage, crafting, and customization.
5. **Discovery** — Apostles sea caves, wrecks, shoals, and secrets worth leaving the shipping lanes.
6. **Grounded history, tall-tale tone** — Real ports and lighthouses; fictional companies where needed; inspired by Seavey’s era, not a biography sim.

---

## Project status

**Planning phase.** System design, research, and architecture are documented under [`plans/`](plans/); there is no playable build yet. The MVP region is **western Lake Superior** (Duluth–Superior, Ashland, Bayfield, Apostle Islands, Two Harbors, and surrounding communities).

Start here:

- [`plans/00-master-plan.md`](plans/00-master-plan.md) — Vision, core loop, systems, roadmap, decisions log
- [`plans/01-tech-architecture.md`](plans/01-tech-architecture.md) — TypeScript, Vite, three.js, saves, performance targets
- [`plans/R1-western-superior-1900-research.md`](plans/R1-western-superior-1900-research.md) — Era and geography research
- [`references/dan_seavey.md`](references/dan_seavey.md) — Historical inspiration (mechanics and tone, not a literal character)

Reference art for ships and era lives in [`references/`](references/) (schooner, early freighters, ferry).

---

## Tech (planned)

Browser-based **desktop** game: **TypeScript**, **Vite**, **three.js** (WebGPU or WebGL per hardware spike), DOM UI (**Preact**), local saves (**IndexedDB**), no backend. Open source, not sold—built for modest hardware, solo dev, and static hosting.

---

## License

| What                                                          | License                     |
| ------------------------------------------------------------- | --------------------------- |
| Source code, plans, and other software text in this repo      | [MIT](LICENSE)              |
| Original game assets (art, audio, media made for the project) | [CC BY 4.0](LICENSE-ASSETS) |

Reference material under [`references/`](references/) and any third-party or AI-generated assets may use other terms; those will be recorded in `ATTRIBUTION.md` as the asset pipeline grows.

---

_Fair winds—or foul, if that’s how you like your profit._

## Development

Requires Node 22+ and [Git LFS](https://git-lfs.com/) (binaries such as models, textures and audio are stored in LFS).

```sh
git lfs install
npm ci
npm run dev        # Vite dev server
npm test           # Vitest unit, data and save-migration tests
npm run lint       # ESLint, including layer import rules
npm run typecheck
npm run build
npm run e2e        # Playwright smoke test (run `npx playwright install chromium` once)
```

Layout follows [plan 01 §6](plans/01-tech-architecture.md). Save migrations live in `src/core/save/migrations/` with one fixture per save version in `tests/fixtures/saves/` ([plan 16 §7](plans/16-save-persistence.md)).
