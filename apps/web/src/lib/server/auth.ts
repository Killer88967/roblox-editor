import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";

/** Hosts the app may be reached at. Extra ones (your domain) come from AUTH_ALLOWED_HOSTS. */
const allowedHosts = [
  "localhost:*",
  "127.0.0.1:*",
  // GitHub Codespaces forwarded ports and Vercel deployments.
  "*.app.github.dev",
  "*.vercel.app",
  ...(process.env.AUTH_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean),
];

const env = process.env;

/** Social sign-in providers that have credentials configured. */
const socialProviders = {
  ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
    ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
    : {}),
  ...(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
    ? { discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET } }
    : {}),
};

function createAuth() {
  return betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    // Work on whatever allowed host the request came in on (Codespaces, previews,
    // production) without setting BETTER_AUTH_URL per environment.
    baseURL: env.BETTER_AUTH_URL ?? { allowedHosts, fallback: "http://localhost:3000" },
    advanced: {
      // Codespaces and Vercel put the public host in x-forwarded-host.
      trustedProxyHeaders: true,
    },
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    socialProviders,
    account: {
      // Signing in with GitHub and Discord using the same email links them to one account.
      accountLinking: { enabled: true, trustedProviders: ["github", "discord"] },
    },
    // Must be last: lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

/** Better Auth, set up on first use (so builds don't need the database). */
export const auth = new Proxy({} as Auth, {
  get(_target, prop) {
    instance ??= createAuth();
    return Reflect.get(instance, prop);
  },
});

export type Session = Auth["$Infer"]["Session"];
