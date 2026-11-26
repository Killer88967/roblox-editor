import { z } from "zod";
import { db } from "@/lib/server/db";
import { MAX_PLACE_BYTES, ownedProject } from "@/lib/server/access";
import { versionInfo } from "@/lib/server/serialize";
import { keys, storage } from "@/lib/server/storage";
import type { UploadTicket } from "@/lib/cloud-types";

/** The project's saved versions, newest first. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/versions">) {
  const { id } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const versions = await db.projectVersion.findMany({
    where: { projectId: id, status: "ready" },
    orderBy: { number: "desc" },
    include: { createdBy: { select: { name: true } } },
    take: 200,
  });
  return Response.json(versions.map(versionInfo));
}

const Start = z.object({
  size: z.number().int().positive().max(MAX_PLACE_BYTES),
  message: z.string().trim().max(200).optional(),
  thumbnail: z.boolean().optional(),
});

/**
 * Starts a save: makes a pending version and returns signed URLs to upload the .rbxl
 * (and a preview image) straight to storage. PATCH the version afterwards to finish.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/versions">) {
  const { id } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const body = Start.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: `Place files must be under ${MAX_PLACE_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }
  const store = storage();
  const version = await db.projectVersion.create({
    data: {
      projectId: id,
      fileKey: "",
      size: body.data.size,
      message: body.data.message || null,
      createdById: owned.user.id,
    },
  });
  const fileKey = keys.version(id, version.id);
  await db.projectVersion.update({ where: { id: version.id }, data: { fileKey } });
  const ticket: UploadTicket = {
    versionId: version.id,
    uploadUrl: await store.uploadUrl(fileKey, "application/octet-stream"),
    thumbnailUploadUrl: body.data.thumbnail
      ? await store.uploadUrl(keys.thumbnail(id, version.id), "image/webp")
      : null,
  };
  return Response.json(ticket, { status: 201 });
}
