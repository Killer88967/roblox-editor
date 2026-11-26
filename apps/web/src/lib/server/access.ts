import "server-only";
import { auth } from "./auth";
import { db } from "./db";
import { ACCOUNTS_ENABLED } from "@/lib/features";

/** A JSON error response. */
export const fail = (status: number, error: string) => Response.json({ error }, { status });

/** The signed-in user for a request, or null. */
export async function currentUser(request: Request) {
  if (!ACCOUNTS_ENABLED) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

/**
 * The project if the request's user owns it. Returns a Response to send back instead
 * when they're signed out (401) or it isn't theirs / doesn't exist (404).
 */
export async function ownedProject(request: Request, id: string) {
  const user = await currentUser(request);
  if (!user) return { error: fail(401, "Sign in first.") } as const;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || project.ownerId !== user.id)
    return { error: fail(404, "Project not found.") } as const;
  return { user, project } as const;
}

/** The project a share token gives view access to, if the token is valid. */
export async function sharedProject(token: string | null) {
  if (!ACCOUNTS_ENABLED) return null;
  if (!token || token.length < 16) return null;
  return db.project.findUnique({ where: { shareToken: token } });
}

/** Largest place file we accept. */
export const MAX_PLACE_BYTES = 200 * 1024 * 1024;
export const MAX_THUMB_BYTES = 512 * 1024;
