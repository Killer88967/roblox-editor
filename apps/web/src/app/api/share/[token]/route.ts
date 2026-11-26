import { db } from "@/lib/server/db";
import { sharedProject } from "@/lib/server/access";
import { versionInfo } from "@/lib/server/serialize";
import { storage } from "@/lib/server/storage";

/** Public, view-only access to a shared project's latest version. */
export async function GET(_request: Request, ctx: RouteContext<"/api/share/[token]">) {
  const { token } = await ctx.params;
  const project = await sharedProject(token);
  if (!project) return Response.json({ error: "This link doesn't work anymore." }, { status: 404 });
  const version = project.currentVersionId
    ? await db.projectVersion.findUnique({
        where: { id: project.currentVersionId },
        include: { createdBy: { select: { name: true } } },
      })
    : null;
  return Response.json({
    name: project.name,
    version: version ? versionInfo(version) : null,
    url: version ? await storage().downloadUrl(version.fileKey) : null,
  });
}
