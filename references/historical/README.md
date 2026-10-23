# Historical references (candidates)

Period look-and-feel references for the water and ship scene, Bayfield and the Apostle Islands,
the Twin Ports, lumber camps, and 1900 charts (plan 14 §12, R1 §6). They are references for
modeling and palette work, not shipped assets.

- `manifest.json` is the catalog: one entry per image, with its source page and why it's here.
- `node tools/assets/fetch-references.mjs` downloads every loc.gov entry (the ~1024 px JPEG) into
  the topic folders and regenerates `SOURCES.md` with the title, date, reproduction number and
  rights statement from each Library of Congress record. Add `--dry-run` to check without
  downloading, `--force` to re-fetch.
- To prune: delete the entry from `manifest.json` and its image, then re-run the script.
- Images here stay plain git files, like the rest of `references/` (see `.gitattributes`).

## Licensing

Almost everything comes from the Library of Congress: Detroit Publishing Company glass negatives
and photochroms, panoramic photos, Sanborn maps (pre-1926) and HABS surveys. These carry "No known
restrictions on publication". `SOURCES.md` flags any record whose rights statement says otherwise.
The 1900 Lake Survey chart is a US government work (public domain).

Left out on purpose:

- **Wisconsin Historical Society** images: their terms require permission for publication, so they
  aren't openly licensed. Good for browsing, but not kept here.
- **Maritime History of the Great Lakes / Alpena library** and **navsource.org** images: mixed or
  unclear rights. Several of navsource's Morrill photos are LoC Detroit Publishing negatives, which
  are in the manifest directly.

## Gaps worth a later pass

- NOAA Office of Coast Survey historical charts (historicalcharts.noaa.gov) for Lake Superior around
  1900, and the US Lake Survey chart 1 of the Apostle Islands at full resolution.
- NPS Apostle Islands historic photos (quarries, fish camps, Stockton and Siskiwit), once their
  rights are checked per image.
- Period clothing, signage and painted lettering.
