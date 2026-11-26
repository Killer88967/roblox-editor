import { db } from "@/lib/server/db";
import { MAX_THUMB_BYTES, ownedProject } from "@/lib/server/access";
import { projectInfo, withCurrentVersion } from "@/lib/server/serialize";
import { keys, storage } from "@/lib/server/storage";

type Ctx = RouteContext<"/api/projects/[id]/versions/[vid]">;

/** A signed download URL for one version's .rbxl. */
export async function GET(request: Request, ctx: Ctx) {
  const { id, vid } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const version = await db.projectVersion.findFirst({
    where: { id: vid, projectId: id, status: "ready" },
  });
  if (!version) return Response.json({ error: "Version not found." }, { status: 404 });
  const name = `${owned.project.name.replace(/[^\w .-]/g, "_")} v${version.number}.rbxl`;
  const download = new URL(request.url).searchParams.has("download");
  return Response.json({
    url: await storage().downloadUrl(version.fileKey, download ? { fileName: name } : undefined),
  });
}

/**
 * Finishes a save once the browser has uploaded the file: checks it arrived, numbers
 * the version, and makes it the project's latest. Returns the updated project.
 */
export async function PATCH(request: Request, ctx: Ctx) {
  const { id, vid } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const version = await db.projectVersion.findFirst({ where: { id: vid, projectId: id } });
  if (!version) return Response.json({ error: "Version not found." }, { status: 404 });
  if (version.status === "ready") {
    const project = await db.project.findUniqueOrThrow({
      where: { id },
      include: withCurrentVersion,
    });
    return Response.json(projectInfo(project));
  }

  const store = storage();
  const size = await store.size(version.fileKey);
  if (size === null)
    return Response.json({ error: "The upload didn't arrive. Try saving again." }, { status: 409 });
  const thumbKey = keys.thumbnail(id, vid);
  const thumbSize = await store.size(thumbKey);
  const hasThumb = thumbSize !== null && thumbSize <= MAX_THUMB_BYTES;

  // Number versions in order of completion; retry if two saves finish at once.
  for (let attempt = 0; ; attempt++) {
    try {
      const project = await db.$transaction(async (tx) => {
        const last = await tx.projectVersion.aggregate({
          where: { projectId: id, status: "ready" },
          _max: { number: true },
        });
        await tx.projectVersion.update({
          where: { id: vid },
          data: { status: "ready", size, number: (last._max.number ?? 0) + 1 },
        });
        return tx.project.update({
          where: { id },
          data: { currentVersionId: vid, ...(hasThumb ? { thumbnailKey: thumbKey } : {}) },
          include: withCurrentVersion,
        });
      });
      return Response.json(projectInfo(project));
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}
