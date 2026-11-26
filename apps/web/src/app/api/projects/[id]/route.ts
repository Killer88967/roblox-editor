import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/server/db";
import { ownedProject } from "@/lib/server/access";
import { projectInfo, withCurrentVersion } from "@/lib/server/serialize";
import { keys, storage } from "@/lib/server/storage";

export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const project = await db.project.findUniqueOrThrow({
    where: { id },
    include: withCurrentVersion,
  });
  return Response.json(projectInfo(project));
}

const Update = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  /** true turns view-only sharing on (new link), false turns it off. */
  shared: z.boolean().optional(),
});

export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  const body = Update.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid changes." }, { status: 400 });
  const { name, shared } = body.data;
  const project = await db.project.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(shared === true ? { shareToken: randomBytes(18).toString("base64url") } : {}),
      ...(shared === false ? { shareToken: null } : {}),
    },
    include: withCurrentVersion,
  });
  return Response.json(projectInfo(project));
}

/** Deletes the project, its versions and their files. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const owned = await ownedProject(request, id);
  if ("error" in owned) return owned.error;
  await db.project.delete({ where: { id } });
  await storage()
    .deletePrefix(keys.project(id))
    .catch(() => {
      // The rows are gone; leftover files are harmless.
    });
  return new Response(null, { status: 204 });
}
