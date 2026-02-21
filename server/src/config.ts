import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
	DATABASE_URL: z.string().min(1),
	API_TOKENS: z.string().min(1),
	PORT: z.coerce.number().int().min(1).max(65535).default(8787),
	MAX_RECORD_BYTES: z.coerce.number().int().min(1024).max(50 * 1024 * 1024).default(5 * 1024 * 1024),
});

const env = EnvSchema.parse(process.env);

export const config = {
	databaseUrl: env.DATABASE_URL,
	apiTokens: env.API_TOKENS.split(',').map((token) => token.trim()).filter(Boolean),
	port: env.PORT,
	maxRecordBytes: env.MAX_RECORD_BYTES,
};