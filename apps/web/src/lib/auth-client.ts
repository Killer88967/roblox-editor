"use client";

import { createAuthClient } from "better-auth/react";

/** Better Auth on the client (same origin, /api/auth). */
export const authClient = createAuthClient();
export const { useSession, signIn, signUp, signOut } = authClient;
