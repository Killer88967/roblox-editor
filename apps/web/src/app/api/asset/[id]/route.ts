import { currentUser, sharedProject } from "@/lib/server/access";
import { AssetError, fetchRobloxAsset, sniff } from "@/lib/server/roblox-assets";
import { keys, storage } from "@/lib/server/storage";

/**
 * A Roblox asset (image, mesh, …) by id: fetched from Roblox once, cached in storage,
 * then served by redirecting to a signed storage URL. Signed-in users can use it, and
 * so can viewers of a shared project (`?s=<share token>`).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/asset/[id]">) {
  const { id } = await ctx.params;
  if (!/^\d{1,20}$/.test(id)) return Response.json({ error: "Bad asset id." }, { status: 400 });
  const share = new URL(request.url).searchParams.get("s");
  if (!(await currentUser(request)) && !(await sharedProject(share))) {
    return Response.json({ error: "Sign in to load Roblox assets." }, { status: 401 });
  }

  const store = storage();
  const key = keys.asset(id);
  if ((await store.size(key)) === null) {
    try {
      const bytes = await fetchRobloxAsset(id);
      await store.put(key, bytes, sniff(bytes));
    } catch (e) {
      const status = e instanceof AssetError ? e.status : 502;
      return Response.json({ error: e instanceof Error ? e.message : "Asset failed." }, { status });
    }
  }
  const url = await store.downloadUrl(key);
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(url, request.url).toString(),
      "cache-control": "private, max-age=600",
    },
  });
}
