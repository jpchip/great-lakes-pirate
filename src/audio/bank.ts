import { AssetLoader, fetchManifest } from '../core/assets';

/**
 * Decoded sounds from the audio manifest that `npm run audio` writes (plan 15 §9). A
 * bundle is acquired as a whole; a sound that fails to load is left out, and whatever
 * plays it just stays quiet.
 */

/** The audio manifest, next to index.html like the asset manifest. */
export const AUDIO_MANIFEST_URL = 'assets/audio/manifest.json';

export type SoundBank = ReadonlyMap<string, AudioBuffer>;

export async function loadSoundBank(
  ctx: BaseAudioContext,
  bundle: string,
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<SoundBank> {
  const manifestUrl = new URL(AUDIO_MANIFEST_URL, baseUrl).href;
  const manifest = await fetchManifest(manifestUrl, fetchFn);
  const loader = new AssetLoader({
    manifest,
    baseUrl: manifestUrl,
    decoders: {
      audio: async (url) => {
        const response = await fetchFn(url);
        if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
        return ctx.decodeAudioData(await response.arrayBuffer());
      },
    },
  });
  const bank = new Map<string, AudioBuffer>();
  const ids = manifest.bundles[bundle] ?? [];
  await Promise.all(
    ids.map(async (id) => {
      try {
        bank.set(id, await loader.acquire<AudioBuffer>(id));
      } catch (err) {
        console.warn(`Sound ${id} unavailable`, err);
      }
    }),
  );
  return bank;
}
