import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/server/auth";

// A function (not the auth object) so Better Auth starts on the first request.
export const { GET, POST } = toNextJsHandler((request: Request) => auth.handler(request));
