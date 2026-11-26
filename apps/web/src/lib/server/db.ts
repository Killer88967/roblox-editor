import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function client() {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (see docs/cloud-setup.md).");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  // One client per server process, reused across hot reloads in dev.
  globalForPrisma.prisma = prisma;
  return prisma;
}

/**
 * The Prisma client, created on first use (so builds don't need DATABASE_URL).
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
