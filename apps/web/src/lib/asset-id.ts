/**
 * The numeric asset id in a Roblox content string: `rbxassetid://123`,
 * `http://www.roblox.com/asset/?id=123`, `https://assetdelivery.roblox.com/v1/asset?id=123`
 * or just `123`. Null for built-in Studio files (`rbxasset://…`) and anything else.
 */
export function assetIdOf(content: string | undefined | null): string | null {
  if (!content) return null;
  const s = content.trim();
  return (
    s.match(/^rbxassetid:\/\/(\d+)/i)?.[1] ??
    s.match(/roblox\.com\/(?:v\d\/)?asset\/?\?(?:.*&)?id=(\d+)/i)?.[1] ??
    s.match(/^(\d+)$/)?.[1] ??
    null
  );
}

/** The app's URL for an asset (fetched from Roblox through the server and cached). */
export function assetUrl(id: string, shareToken?: string | null) {
  return `/api/asset/${id}${shareToken ? `?s=${encodeURIComponent(shareToken)}` : ""}`;
}
