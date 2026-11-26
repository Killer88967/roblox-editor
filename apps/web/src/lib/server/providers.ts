import "server-only";

/**
 * Social sign-in providers with credentials configured. Kept apart from auth.ts so
 * pages can read it without connecting to the database.
 */
export function enabledProviders() {
  const env = process.env;
  const out: ("github" | "discord")[] = [];
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) out.push("github");
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) out.push("discord");
  return out;
}
