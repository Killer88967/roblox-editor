import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server/auth";
import { ACCOUNTS_ENABLED } from "@/lib/features";

// A function (not the auth object) so Better Auth starts on the first request. While
// accounts are off, nothing here answers (and the database is never touched).
export const { GET, POST } = toNextJsHandler((request: Request) =>
  ACCOUNTS_ENABLED
    ? auth.handler(request)
    : Promise.resolve(Response.json({ error: "Accounts are turned off." }, { status: 404 })),
);
