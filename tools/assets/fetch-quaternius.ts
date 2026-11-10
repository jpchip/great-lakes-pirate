#!/usr/bin/env node
// Fetches the CC0 Quaternius character packs the captain's body is built from (plan 08
// §20 piece B, plan 14 §5) and repacks the parts we use into raw-assets/characters/.
//
//   node tools/assets/fetch-quaternius.ts                 # download the free Standard zips
//   node tools/assets/fetch-quaternius.ts --zips <dir>    # or use zips you downloaded
//
// The four packs are free ("name your own price", $0) on itch.io and CC0 1.0:
//   Universal Base Characters, Modular Character Outfits - Fantasy,
//   Universal Animation Library, Universal Animation Library 2.
// Download them by hand from https://quaternius.itch.io if the scripted fetch breaks;
// any zip whose name starts with the pack's title works with --zips.
//
// The repack keeps only what tools/assets/build-characters.ts reads: each part as one GLB
// with its base color texture shrunk to 1024 px (the normal, roughness and ORM maps are
// dropped, since the toon material doesn't use them), and the two animation libraries
// with their mannequin mesh removed. Nothing is reshaped here; the build step does that.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import sharp from 'sharp';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const OUT = join(ROOT, 'raw-assets', 'characters', 'quaternius');
const CACHE = join(ROOT, 'tools', 'assets', '.cache', 'quaternius');

interface Pack {
  slug: string;
  title: string;
  zip: string;
}

const PACKS: Pack[] = [
  { slug: 'universal-base-characters', title: 'Universal Base Characters', zip: 'ubc' },
  {
    slug: 'modular-character-outfits-fantasy',
    title: 'Modular Character Outfits - Fantasy',
    zip: 'outfits',
  },
  { slug: 'universal-animation-library', title: 'Universal Animation Library', zip: 'ual1' },
  { slug: 'universal-animation-library-2', title: 'Universal Animation Library 2', zip: 'ual2' },
];

/** Source file (inside the unzipped pack) → repacked raw asset. */
const PARTS: { pack: string; from: string; to: string; anim?: boolean }[] = [
  {
    pack: 'outfits',
    from: 'Exports/glTF (Godot-Unreal)/Outfits/Male_Peasant.gltf',
    to: 'outfit-peasant-male.glb',
  },
  {
    pack: 'outfits',
    from: 'Exports/glTF (Godot-Unreal)/Outfits/Female_Peasant.gltf',
    to: 'outfit-peasant-female.glb',
  },
  {
    pack: 'ubc',
    from: 'Base Characters/Godot - UE/Superhero_Male_FullBody.gltf',
    to: 'base-male.glb',
  },
  {
    pack: 'ubc',
    from: 'Base Characters/Godot - UE/Superhero_Female_FullBody.gltf',
    to: 'base-female.glb',
  },
  ...['Buzzed', 'SimpleParted', 'Long', 'Buns', 'Beard'].map((name) => ({
    pack: 'ubc',
    from: `Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_${name}.gltf`,
    to: `hair-${name.toLowerCase()}.glb`,
  })),
  { pack: 'ual1', from: 'Unreal-Godot/UAL1_Standard.glb', to: 'anim-ual1.glb', anim: true },
  { pack: 'ual2', from: 'Unreal-Godot/UAL2_Standard.glb', to: 'anim-ual2.glb', anim: true },
];

function itchDownload(pack: Pack, out: string): void {
  // itch.io's own download flow for free packs: the page's CSRF token, then the upload's
  // signed URL. Brittle by nature; --zips is the fallback.
  const jar = join(CACHE, `${pack.zip}.cookies`);
  const curl = (...args: string[]): string =>
    execFileSync('curl', ['-sS', '-m', '60', '-c', jar, '-b', jar, ...args], {
      encoding: 'utf8',
      maxBuffer: 64 << 20,
    });
  const page = `https://quaternius.itch.io/${pack.slug}`;
  const token = (html: string): string => {
    const match = /name="csrf_token" value="([^"]+)"/.exec(html);
    if (!match?.[1]) throw new Error(`no CSRF token on ${page}`);
    return match[1];
  };
  const html = curl(page);
  const { url } = JSON.parse(
    curl('-X', 'POST', '--data-urlencode', `csrf_token=${token(html)}`, `${page}/download_url`),
  ) as { url: string };
  const downloadPage = curl(url);
  const uploads = [...downloadPage.matchAll(/data-upload_id="(\d+)"[\s\S]*?title="([^"]+\.zip)"/g)];
  const standard = uploads.find((m) => m[2]?.includes('[Standard]'));
  if (!standard?.[1]) throw new Error(`no Standard zip listed for ${pack.title}`);
  const signed = JSON.parse(
    curl(
      '-X',
      'POST',
      '--data-urlencode',
      `csrf_token=${token(curl(page))}`,
      `${page}/file/${standard[1]}?source=view_game&as_props=1&after_download_lightbox=true`,
    ),
  ) as { url: string };
  execFileSync('curl', ['-sS', '-L', '-m', '1200', '-o', out, signed.url]);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function shrinkTextures(doc: Document): Promise<void> {
  const root = doc.getRoot();
  for (const material of root.listMaterials()) {
    material.setNormalTexture(null);
    material.setOcclusionTexture(null);
    material.setMetallicRoughnessTexture(null);
    material.setEmissiveTexture(null);
  }
  await doc.transform(prune());
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    if (!image) continue;
    const png = await sharp(Buffer.from(image))
      .resize(1024, 1024, { fit: 'inside' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    texture.setImage(new Uint8Array(png)).setMimeType('image/png');
  }
}

/** Some packs' glTF files name textures `X_png.png` where the file is `X.png`. */
function fixImageUris(gltf: string): void {
  if (!gltf.endsWith('.gltf')) return;
  const json = JSON.parse(readFileSync(gltf, 'utf8')) as { images?: { uri?: string }[] };
  for (const image of json.images ?? []) {
    if (!image.uri) continue;
    const want = join(dirname(gltf), decodeURIComponent(image.uri));
    const have = want.replace(/_png\.png$/, '.png');
    if (!existsSync(want) && existsSync(have)) copyFileSync(have, want);
  }
}

async function repack(from: string, to: string, anim: boolean): Promise<void> {
  fixImageUris(from);
  const doc = await io.read(from);
  const root = doc.getRoot();
  if (anim) {
    // The libraries ship a mannequin; keep its skeleton and clips, not its mesh.
    for (const node of root.listNodes()) node.setMesh(null);
    for (const mesh of root.listMeshes()) mesh.dispose();
    for (const material of root.listMaterials()) material.dispose();
    await doc.transform(prune({ keepLeaves: true }));
  } else {
    await shrinkTextures(doc);
  }
  await io.write(to, doc);
  console.log(`  ${to.slice(ROOT.length + 1)}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const zipsArg = args.indexOf('--zips');
  const zipDir = zipsArg >= 0 ? resolve(args[zipsArg + 1] ?? '.') : CACHE;
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });

  const unpacked = new Map<string, string>();
  for (const pack of PACKS) {
    let zip = readdirSync(zipDir)
      .filter((f) => f.startsWith(`${pack.title}[`) && f.endsWith('.zip'))
      .map((f) => join(zipDir, f))[0];
    if (!zip) {
      if (zipsArg >= 0) throw new Error(`no "${pack.title}[*.zip" in ${zipDir}`);
      zip = join(CACHE, `${pack.title}[Standard].zip`);
      console.log(`fetching ${pack.title}`);
      itchDownload(pack, zip);
    }
    const dir = join(CACHE, pack.zip);
    if (!existsSync(dir)) execFileSync('unzip', ['-q', '-o', zip, '-d', dir]);
    const top = readdirSync(dir).find((f) => f.startsWith(`${pack.title}[`));
    if (!top) throw new Error(`unexpected layout in ${zip}`);
    unpacked.set(pack.zip, join(dir, top));
  }

  console.log('repacking');
  for (const part of PARTS) {
    const base = unpacked.get(part.pack);
    if (!base) throw new Error(`pack ${part.pack} not unpacked`);
    await repack(join(base, part.from), join(OUT, part.to), part.anim === true);
  }
  writeFileSync(
    join(CACHE, 'fetched.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10) }, null, 2),
  );
}

await main();
