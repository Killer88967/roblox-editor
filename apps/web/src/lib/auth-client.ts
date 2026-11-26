"use client";

import { createAuthClient } from "better-auth/react";
import { ACCOUNTS_ENABLED } from "./features";

/** Better Auth on the client (same origin, /api/auth). */
export const authClient = createAuthClient();
export const { useSession, signIn, signUp, signOut } = authClient;

const noSession = () => ({ data: null, isPending: false }) as const;

/**
 * The signed-in session, or none while accounts are turned off (without asking the
 * server, whose auth routes are off too).
 */
export const useAccountSession: () => {
  data: ReturnType<typeof useSession>["data"];
  isPending: boolean;
} = ACCOUNTS_ENABLED ? useSession : noSession;
