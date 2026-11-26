import { z } from "zod";
import { db } from "@/lib/server/db";
import { currentUser, fail } from "@/lib/server/access";
import { projectInfo, withCurrentVersion } from "@/lib/server/serialize";

/** The signed-in user's projects, most recently changed first. */
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return fail(401, "Sign in first.");
  const projects = await db.project.findMany({
    where: { ownerId: user.id },
    orderBy: { updatedAt: "desc" },
    include: withCurrentVersion,
  });
  return Response.json(projects.map(projectInfo));
}

const Create = z.object({ name: z.string().trim().min(1).max(100) });

/** Creates an empty project (the first save uploads its contents). */
export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return fail(401, "Sign in first.");
  const body = Create.safeParse(await request.json().catch(() => null));
  if (!body.success) return fail(400, "Give the project a name (up to 100 characters).");
  const project = await db.project.create({
    data: { name: body.data.name, ownerId: user.id },
    include: withCurrentVersion,
  });
  return Response.json(projectInfo(project), { status: 201 });
}
