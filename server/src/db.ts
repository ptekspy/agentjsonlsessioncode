import { PrismaClient } from '@prisma/client';

declare global {
	var __datasetPrisma__: PrismaClient | undefined;
}

export const prisma = globalThis.__datasetPrisma__ ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
	globalThis.__datasetPrisma__ = prisma;
}