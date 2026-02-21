import type { ApplyPatchArgs, RunCmdArgs, ToolName, TrainingRecord } from './tooling';

export function makeSystem(content: string) {
	return { role: 'system' as const, content };
}

export function makeUser(content: string) {
	return { role: 'user' as const, content };
}

export function makeToolCallMessage(
	callId: string,
	toolName: ToolName,
	argsObj: unknown,
) {
	return {
		role: 'assistant' as const,
		tool_calls: [
			{
				id: callId,
				type: 'function' as const,
				function: {
					name: toolName,
					arguments: JSON.stringify(argsObj),
				},
			},
		],
	};
}

export function makeToolResultMessage(callId: string, content: string) {
	return { role: 'tool' as const, tool_call_id: callId, content };
}

export function addApplyPatch(
	record: TrainingRecord,
	callId: string,
	args: ApplyPatchArgs,
	toolResult = '{"ok":true}',
) {
	record.messages.push(makeToolCallMessage(callId, 'apply_patch', args));
	record.messages.push(makeToolResultMessage(callId, toolResult));
}

export function addRunCmd(
	record: TrainingRecord,
	callId: string,
	args: RunCmdArgs,
	toolOutput: string,
) {
	record.messages.push(makeToolCallMessage(callId, 'run_cmd', args));
	record.messages.push(makeToolResultMessage(callId, toolOutput));
}