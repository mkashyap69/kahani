import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __kahaniPrisma?: PrismaClient };

/** Shared Prisma client (re-used across Next.js hot reloads). */
export const prisma: PrismaClient = globalForPrisma.__kahaniPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__kahaniPrisma = prisma;

export * from "@prisma/client";
