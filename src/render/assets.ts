import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { AssetLoader, fetchManifest, type AssetEntry, type AssetManifest } from '../core/assets';

export type { GLTF };

/** The manifest the asset pipeline writes (plan 01 §4.9), next to index.html. */
export const MANIFEST_URL = 'assets/manifest.json';

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials: THREE.Material[] = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) value.dispose();
        }
        material.dispose();
      }
    }
  });
}

function dispose(value: unknown, entry: AssetEntry): void {
  if (entry.type === 'gltf') disposeObject((value as GLTF).scene);
  else if (value instanceof THREE.Texture) value.dispose();
}

/** The three.js side of the loader: meshopt-compressed GLB and plain textures. */
export function createAssetLoader(manifest: AssetManifest, baseUrl: string): AssetLoader {
  const gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  // KTX2 textures get a KTX2Loader here once the pipeline produces them.
  const textures = new THREE.TextureLoader();
  return new AssetLoader({
    manifest,
    baseUrl,
    decoders: {
      gltf: (url) => gltf.loadAsync(url),
      texture: async (url) => {
        const texture = await textures.loadAsync(url);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
      },
      json: async (url) => (await fetch(url)).json() as Promise<unknown>,
    },
    dispose,
  });
}

/** Fetch the manifest relative to the page and build the loader. */
export async function loadAssets(): Promise<AssetLoader> {
  const manifestUrl = new URL(MANIFEST_URL, document.baseURI).href;
  return createAssetLoader(await fetchManifest(manifestUrl), manifestUrl);
}
