import type { BuiltSessionResult } from '../session-manager';

export function buildUploadPayload(
	result: BuiltSessionResult,
	uploadMode: 'full' | 'metadataOnly',
): BuiltSessionResult['payload'] {
	if (uploadMode === 'full') {
		return result.payload;
	}

	const baseMessages = result.payload.record.messages.filter(
		(message) => message.role === 'system' || message.role === 'user',
	);

	const metadataRecord = {
		messages: [
			...baseMessages,
			{
				role: 'assistant' as const,
				content: 'Metadata-only upload mode enabled; tool traces and file contents were omitted.',
			},
		],
	};

	return {
		...result.payload,
		repo: {
			...result.payload.repo,
			root: '[redacted-local-path]',
			remote: undefined,
		},
		metrics: {
			filesChanged: result.payload.metrics.filesChanged,
			commandsRun: [],
		},
		status: 'draft',
		record: metadataRecord,
	};
}
