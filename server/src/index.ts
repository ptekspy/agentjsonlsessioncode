import Fastify from 'fastify';
import type { Prisma } from '@prisma/client';
import { config } from './config.js';
import { CreateSessionBody, CreateTaskBody, ExportQuery, validateTrainingRecord } from './contracts.js';
import { prisma } from './db.js';
import { redactSecrets, requireBearerToken } from './security.js';

const app = Fastify({
	logger: true,
	bodyLimit: config.maxRecordBytes,
});

app.get('/health', async () => ({ ok: true }));

app.addHook('onRequest', async (request, reply) => {
	if (request.url === '/health') {
		return;
	}
	if (!requireBearerToken(request, reply, config.apiTokens)) {
		return reply;
	}
});

app.get('/tasks', async () => {
	const tasks = await prisma.task.findMany({
		orderBy: { createdAt: 'desc' },
	});

	return tasks.map((task) => ({
		id: task.id,
		name: task.name,
		description: task.description,
		createdAt: task.createdAt.toISOString(),
	}));
});

app.post('/tasks', async (request, reply) => {
	const parsed = CreateTaskBody.safeParse(request.body);
	if (!parsed.success) {
		return reply.code(400).send({ error: parsed.error.flatten() });
	}

	const task = await prisma.task.create({
		data: {
			id: parsed.data.id,
			name: parsed.data.name,
			description: parsed.data.description,
		},
	});

	return reply.code(201).send({
		id: task.id,
		name: task.name,
		description: task.description,
		createdAt: task.createdAt.toISOString(),
	});
});

app.post('/sessions', async (request, reply) => {
	const body = CreateSessionBody.safeParse(request.body);
	if (!body.success) {
		return reply.code(400).send({ error: body.error.flatten() });
	}

	try {
		validateTrainingRecord(body.data.record);
	} catch (error) {
		return reply.code(400).send({ error: toErrorMessage(error) });
	}

	const rawSizeBytes = Buffer.byteLength(JSON.stringify(body.data), 'utf8');
	if (rawSizeBytes > config.maxRecordBytes) {
		return reply
			.code(413)
			.send({ error: `Payload too large (${rawSizeBytes} bytes), max ${config.maxRecordBytes}` });
	}

	const redactedRecord = redactSecrets(body.data.record);

	try {
		const created = await prisma.session.create({
			data: {
				taskId: body.data.taskId,
				repoName: body.data.repo.name,
				repoRemote: body.data.repo.remote,
				branch: body.data.repo.branch,
				baseRef: body.data.baseRef,
				createdAt: new Date(body.data.createdAt),
				status: body.data.status ?? 'draft',
				record: redactedRecord as Prisma.InputJsonValue,
			},
		});

		return reply.code(201).send({ sessionId: created.id });
	} catch (error) {
		return reply.code(500).send({ error: toErrorMessage(error) });
	}
});

app.get('/export.jsonl', async (request, reply) => {
	const parsed = ExportQuery.safeParse(request.query);
	if (!parsed.success) {
		return reply.code(400).send({ error: parsed.error.flatten() });
	}

	const where = {
		taskId: parsed.data.taskId,
		...(parsed.data.since
			? {
				createdAt: {
					gte: new Date(parsed.data.since),
				},
			}
			: {}),
	};

	const sessions = await prisma.session.findMany({
		where,
		orderBy: { createdAt: 'asc' },
		take: parsed.data.limit,
		select: { record: true },
	});

	reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
	reply.raw.write('');

	for (const session of sessions) {
		const value = session.record as { messages?: unknown };
		const line = JSON.stringify({ messages: value.messages ?? [] });
		reply.raw.write(`${line}\n`);
	}

	reply.raw.end();
	return reply;
});

app
	.listen({ port: config.port, host: '0.0.0.0' })
	.then(() => {
		app.log.info(`dataset-server listening on :${config.port}`);
	})
	.catch((error) => {
		app.log.error(error);
		process.exit(1);
	});

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}