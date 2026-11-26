import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The Prisma CLI doesn't read .env files itself; Next.js does for the app.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Not needed for `prisma generate`, so an unset URL only matters for migrations.
    url: process.env.DATABASE_URL ?? "",
  },
});
