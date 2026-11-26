/**
 * Accounts (sign-in, cloud projects, share links) are off unless
 * NEXT_PUBLIC_ACCOUNTS_ENABLED=true. They need a database and file storage (see
 * docs/cloud-setup.md); without them the app is the local editor only. NEXT_PUBLIC_ means
 * the value is built into the client too, so changing it needs a rebuild/redeploy.
 */
export const ACCOUNTS_ENABLED = process.env.NEXT_PUBLIC_ACCOUNTS_ENABLED === "true";
