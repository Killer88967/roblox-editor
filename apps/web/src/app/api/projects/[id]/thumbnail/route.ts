import { db } from "@/lib/server/db";
import { currentUser } from "@/lib/server/access";
import { storage } from "@/lib/server/storage";

/** Redirects to the project's preview image (owner only). */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/thumbnail">) {
  const { id } = await ctx.params;
  const user = await currentUser(request);
  const project = user ? await db.project.findUnique({ where: { id } }) : null;
  if (!project || project.ownerId !== user?.id || !project.thumbnailKey) {
    return new Response(null, { status: 404 });
  }
  const url = await storage().downloadUrl(project.thumbnailKey);
  return Response.redirect(new URL(url, request.url), 302);
}
