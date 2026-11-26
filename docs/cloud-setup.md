# Cloud setup (accounts, saves, sharing, Roblox assets)

Accounts are **off** by default. Set `NEXT_PUBLIC_ACCOUNTS_ENABLED=true` (in
`apps/web/.env.local`, and in Vercel, then redeploy) to turn them on. While they're off,
the account pages say so and the account APIs return 404 without touching the database.

The editor works without any of this: `/` is the local editor. Accounts add `/dashboard`
(your projects), `/p/<id>` (a cloud project with version history) and `/s/<token>`
(view-only share links). All settings are environment variables; see
`apps/web/.env.example`.

## 1. In your Codespace (no outside accounts needed)

A rebuilt devcontainer does this for you. On an existing Codespace, run once:

```bash
echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" >> apps/web/.env.local
echo "NEXT_PUBLIC_ACCOUNTS_ENABLED=true" >> apps/web/.env.local
pnpm install
pnpm --filter web db:deploy   # creates the tables in the devcontainer's Postgres
pnpm dev
```

Email + password sign-in works straight away. Saved places go to `apps/web/.data/` on
disk (git-ignored) until R2 is set up. After changing `prisma/schema.prisma`, run
`pnpm --filter web db:migrate` to create a migration (CI fails if you forget).

## 2. Production database (Vercel)

1. In Vercel: **Storage → Create → Neon (Postgres)** and connect it to the project. That
   sets `DATABASE_URL`.
2. Create the tables from your Codespace (copy the URL from Vercel → Storage → Neon):
   ```bash
   DATABASE_URL="postgresql://…" pnpm --filter web db:deploy
   ```
   Run this again whenever a PR adds a migration. (To run it on every deploy instead, set
   Vercel's Build Command to `pnpm --filter web db:deploy && pnpm --filter web build`.)
3. Add `BETTER_AUTH_SECRET` (a new `openssl rand -base64 32`, not your dev one).

Sign-in works on `localhost`, `*.app.github.dev` and `*.vercel.app` automatically. For your
own domain, add it to `AUTH_ALLOWED_HOSTS` (e.g. `robloxeditor.com`).

## 3. Cloudflare R2 (file storage)

1. Cloudflare dashboard → **R2** → Create bucket (e.g. `roblox-editor`).
2. R2 → **Manage API tokens** → Create token with **Object Read & Write** for that bucket.
   Note the Access Key ID, Secret Access Key, and your Account ID.
3. Bucket → **Settings → CORS policy**, so browsers can upload and download directly:
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000", "https://your-app.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   Add your Codespace URL (`https://<name>-3000.app.github.dev`) and custom domain too, or
   use `"*"`: every URL is signed and expires after 15 minutes either way.
4. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (in
   `apps/web/.env.local` and in Vercel).

Files: `projects/<id>/versions/<version>.rbxl`, `projects/<id>/thumbs/<version>.webp`, and
cached Roblox assets under `assets/roblox/<asset id>`. Deleting a project deletes its files.

## 4. Sign in with GitHub / Discord (optional)

The callback URL is `https://<your host>/api/auth/callback/<provider>`.

- **GitHub:** Settings → Developer settings → **OAuth Apps** → New. A GitHub OAuth app has
  one callback URL, so make one app for your Codespace and one for production. Set
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`.
- **Discord:** discord.com/developers → New Application → **OAuth2** → add each redirect
  (Codespace, production). Set `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`.

The login page only shows the providers that are configured. Signing in with both using
the same email links them to one account.

## 5. Roblox assets (decal and texture images)

Roblox has required authentication for asset downloads since April 2025, so the server
fetches assets with an Open Cloud API key and caches them in storage.

1. create.roblox.com → **Dashboard → Credentials (Open Cloud) → Create API key**.
2. Add the **legacy-asset** API system with the **manage** permission
   (`legacy-asset:manage`), and allow IP `0.0.0.0/0` (Vercel's IPs change).
3. Set `ROBLOX_API_KEY`.

Signed-in users and share-link viewers get real images on Decals and Textures (tinted by
Color3, tiled by StudsPerTileU/V). Without a key the editor keeps the tinted placeholders.
Each asset is downloaded from Roblox once; after that it's served from storage.
