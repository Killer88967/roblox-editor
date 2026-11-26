"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { assetIdOf, assetUrl } from "./asset-id";

/** Loaded (or failed) textures by URL, shared by every decal that uses the same image. */
const cache = new Map<string, Promise<THREE.Texture | null>>();

function load(url: string) {
  let p = cache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        url,
        (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          resolve(t);
        },
        undefined,
        // Not signed in, not an image, Roblox said no: draw the plain overlay instead.
        () => resolve(null),
      );
    });
    cache.set(url, p);
  }
  return p;
}

/**
 * The image for a Roblox content string (e.g. a Decal's Texture), loaded through the
 * asset proxy. Null while loading, when assets are off, or if it can't be loaded.
 */
export function useAssetTexture(content: string, enabled: boolean, shareToken: string | null) {
  const id = enabled ? assetIdOf(content) : null;
  const url = id ? assetUrl(id, shareToken) : null;
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    load(url).then((texture) => live && setLoaded({ url, texture }));
    return () => {
      live = false;
    };
  }, [url]);
  return url && loaded?.url === url ? loaded.texture : null;
}
