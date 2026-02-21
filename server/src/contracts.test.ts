import test from 'node:test';
import assert from 'node:assert/strict';
import { TrainingRecord, deriveSessionStatusFromRecord, validateTrainingRecord } from './contracts.js';

function makeRunCmdRecord(args: string[]) {
	const runArgs = { cmd: 'pnpm' as const, args };
	return TrainingRecord.parse({
		messages: [
			{ role: 'system', content: 'system' } as const,
			{ role: 'user', content: 'user' } as const,
			{
				role: 'assistant' as const,
				tool_calls: [
					{
						id: 'run_1',
						type: 'function' as const,
						function: {
							name: 'run_cmd' as const,
							arguments: JSON.stringify(runArgs),
						},
					},
				],
			},
			{ role: 'tool', tool_call_id: 'run_1', content: 'ok' } as const,
			{
				role: 'assistant' as const,
				tool_calls: [
					{
						id: 'patch_1',
						type: 'function' as const,
						function: {
							name: 'apply_patch' as const,
							arguments: JSON.stringify({
								data: {
									action: {
										operations: [
											{
												type: 'update_file',
												path: 'src/file.ts',
												diff: '@@ -1,1 +1,1 @@\n-a\n+b\n',
											},
										],
									},
								},
							}),
						},
					},
				],
			},
			{ role: 'tool', tool_call_id: 'patch_1', content: '{"ok":true}' } as const,
		],
	});
}

test('deriveSessionStatusFromRecord returns ready when apply_patch and validation run_cmd exist', () => {
	const record = makeRunCmdRecord(['lint']);
	assert.equal(deriveSessionStatusFromRecord(record), 'ready');
});

test('deriveSessionStatusFromRecord returns draft without validation command', () => {
	const record = makeRunCmdRecord(['add', 'zod']);
	assert.equal(deriveSessionStatusFromRecord(record), 'draft');
});

test('validateTrainingRecord rejects tool result before tool call', () => {
	const record = TrainingRecord.parse({
		messages: [
			{ role: 'system', content: 'system' } as const,
			{ role: 'user', content: 'user' } as const,
			{ role: 'tool', tool_call_id: 'x', content: 'ok-early' } as const,
			{
				role: 'assistant' as const,
				tool_calls: [
					{
						id: 'x',
						type: 'function' as const,
						function: {
							name: 'repo.readFile' as const,
							arguments: JSON.stringify({ path: 'a.ts' }),
						},
					},
				],
			},
		],
	});

	assert.throws(
		() => validateTrainingRecord(record),
		/(unknown tool_call_id|before corresponding tool call)/i,
	);
});

test('validateTrainingRecord rejects duplicate apply_patch calls', () => {
	const record = TrainingRecord.parse({
		messages: [
			{ role: 'system', content: 'system' } as const,
			{ role: 'user', content: 'user' } as const,
			{
				role: 'assistant' as const,
				tool_calls: [
					{
						id: 'p1',
						type: 'function' as const,
						function: {
							name: 'apply_patch' as const,
							arguments: JSON.stringify({
								data: { action: { operations: [{ type: 'delete_file', path: 'a.ts' }] } },
							}),
						},
					},
				],
			},
			{ role: 'tool', tool_call_id: 'p1', content: 'ok' } as const,
			{
				role: 'assistant' as const,
				tool_calls: [
					{
						id: 'p2',
						type: 'function' as const,
						function: {
							name: 'apply_patch' as const,
							arguments: JSON.stringify({
								data: { action: { operations: [{ type: 'delete_file', path: 'b.ts' }] } },
							}),
						},
					},
				],
			},
			{ role: 'tool', tool_call_id: 'p2', content: 'ok' } as const,
		],
	});

	assert.throws(() => validateTrainingRecord(record), /at most one apply_patch/i);
});
