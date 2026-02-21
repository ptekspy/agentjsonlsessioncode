import { PrismaClient } from '@prisma/client';
export const prisma = globalThis.__datasetPrisma__ ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') {
    globalThis.__datasetPrisma__ = prisma;
}
//# sourceMappingURL=db.js.map