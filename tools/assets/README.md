# Asset pipeline

Plan 14 §7. Only the hull path exists so far (spike S4); props, characters and kits join it later.

## Hulls: `npm run assets:hull -- raw-assets/ships/<name>`

```
raw-assets/ships/<name>/
  asset.json        hints: manifest id, target length and draft, triangle budget, bow direction
  provenance.json   who or what made it, from what, under which license (plan 14 §6)
  meshy.glb         the raw export named in asset.json "source"
        │
        ▼  tools/assets/blender/clean.py (headless Blender 4.2+, local only)
  merge by distance → drop junk islands → orient (long axis fore-aft, narrow end = bow)
  → scale to length, waterline at y = 0 → palette-ize the texture into vertex colors
  → voxel remesh if torn → decimate to budget
        │
        ▼  tools/assets/build-hull.ts (gltf-transform)
  dedup, weld, simplify if still over budget, budget check, meshopt compression
        │
        ▼
public/assets/ships/<name>.glb                  the hull the game loads
public/assets/ships/<name>.provenance.json      raw provenance plus the pipeline steps
public/assets/manifest.json                     entry for the asset id
```

Blender is found on the `PATH` or through `BLENDER=/path/to/blender`. The intermediate files
and Blender's report go to `tools/assets/.cache/<name>/` (not committed); read
`clean-report.json` there to see what each step did (bow detected, faces per palette color,
whether it remeshed). `--skip-clean` reruns only the gltf-transform half.

Masts, spars, sails and rigging are never taken from the AI mesh: the game draws them
procedurally on top of the hull (plan 14 §5). Generate hulls without sails, or set
`stripAboveM` in `asset.json` to cut away anything above that height.

## Making the T1 schooner hull with Meshy (spike S4)

1. **A sail-free input image.** `references/schooner.png` is full of canvas, which Meshy would
   model as solid slabs. Make a hull-only image first: with nano-banana (Gemini image
   generation), ask for "this schooner's hull only, three-quarter view from the bow, no masts,
   sails or rigging, plain white background, even lighting" with the photo attached. A side
   view and a top view help if Meshy offers multi-view input.
2. **Meshy image-to-3D** (meshy.ai, web app). Upload the image, keep the texture on, and pick
   the lowest polycount the export offers (the pipeline decimates anyway). Download **GLB**.
3. Save it as `raw-assets/ships/schooner-t1/meshy.glb` straight away (Meshy's terms say API
   outputs are deleted after three days for non-Enterprise accounts, so don't count on
   downloading it again later).
4. Write `raw-assets/ships/schooner-t1/provenance.json`:
   ```json
   {
     "source": "ai",
     "tool": "Meshy <model version> (web app, <free or paid> plan) via nano-banana input",
     "author": "<your name>",
     "reference": "references/schooner.png",
     "prompt": "<the image prompt you used>",
     "date": "<YYYY-MM-DD>",
     "license": "CC BY 4.0",
     "attribution": "Generated with Meshy (meshy.ai)",
     "termsUrl": "https://www.meshy.ai/terms-of-use",
     "modifications": []
   }
   ```
   On a paid plan, put the license Meshy grants there instead; `assets/LICENSES.json` has both.
5. `BLENDER=/path/to/blender npm run assets:hull -- raw-assets/ships/schooner-t1`
6. Add the hull to `CREDITS.md` (the script prints the credit line), then open
   `/bench/s4/`: the readout says `hull: pipeline` once the scene picks it up.

If the result is unusable, regenerate rather than repair (plan 14 §7): change the image or
the hints (`bow`, `stripAboveM`, `maxTriangles`) and run it again.
