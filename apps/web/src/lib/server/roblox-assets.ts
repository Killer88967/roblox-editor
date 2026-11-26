import "server-only";

export class AssetError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A content type for asset bytes, from their first bytes. */
export function sniff(bytes: Uint8Array): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57) return "image/webp";
  const head = new TextDecoder().decode(b.subarray(0, 16));
  if (head.startsWith("<roblox")) return "application/xml";
  return "application/octet-stream";
}

/** In a Decal-style model asset, the id of the image it points at. */
function imageIdInModel(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes.subarray(0, 64 * 1024));
  return (
    text.match(/roblox\.com\/asset\/?\?id=(\d+)/i)?.[1] ?? text.match(/rbxassetid:\/\/(\d+)/i)?.[1]
  );
}

/**
 * Downloads an asset from Roblox with the Open Cloud Asset Delivery API (Roblox has
 * required authentication for asset downloads since April 2025). Needs ROBLOX_API_KEY
 * with the `legacy-asset:manage` scope. Decal assets are small models that point at an
 * image; those are followed to the image itself.
 */
export async function fetchRobloxAsset(id: string, depth = 0): Promise<Uint8Array> {
  const apiKey = process.env.ROBLOX_API_KEY;
  if (!apiKey)
    throw new AssetError(503, "Roblox assets aren't set up (ROBLOX_API_KEY is missing).");
  const meta = await fetch(`https://apis.roblox.com/asset-delivery-api/v1/assetId/${id}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!meta.ok) {
    const status = meta.status === 404 || meta.status === 403 ? 404 : 502;
    throw new AssetError(status, `Roblox returned ${meta.status} for asset ${id}.`);
  }
  const { location } = (await meta.json()) as { location?: string };
  if (!location) throw new AssetError(502, `Roblox gave no download location for asset ${id}.`);
  const file = await fetch(location);
  if (!file.ok) throw new AssetError(502, `Downloading asset ${id} failed (${file.status}).`);
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (depth === 0 && sniff(bytes) === "application/xml") {
    const inner = imageIdInModel(bytes);
    if (inner && inner !== id) return fetchRobloxAsset(inner, 1);
  }
  return bytes;
}
