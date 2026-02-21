import { z } from 'zod';

export const ToolName = z.enum([
	'repo.readFile',
	'repo.search',
	'repo.listTree',
	'run_cmd',
	'apply_patch',
]);

export type ToolName = z.infer<typeof ToolName>;

export const RepoReadFileArgs = z.object({
	path: z.string().min(1),
});

export type RepoReadFileArgs = z.infer<typeof RepoReadFileArgs>;

export const ApplyPatchOperation = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('create_file'),
		path: z.string().min(1),
		diff: z.string(),
	}),
	z.object({
		type: z.literal('update_file'),
		path: z.string().min(1),
		diff: z.string().min(1),
	}),
	z.object({
		type: z.literal('delete_file'),
		path: z.string().min(1),
	}),
]);

export type ApplyPatchOperation = z.infer<typeof ApplyPatchOperation>;

export const ApplyPatchArgs = z.object({
	data: z.object({
		action: z.object({
			operations: z.array(ApplyPatchOperation).min(1),
		}),
	}),
});

export type ApplyPatchArgs = z.infer<typeof ApplyPatchArgs>;

export type RunCmdArgs = {
	cmd: 'pnpm';
	args: string[];
	cwd?: string;
	timeoutMs?: number;
	env?: Record<string, string>;
};

export type AllowedRunCmd =
	| { kind: 'lint' | 'test' | 'build'; filter?: string; recursive?: boolean }
	| { kind: 'install'; filter?: string }
	| { kind: 'add'; filter?: string; dev: boolean; packages: string[] }
	| { kind: 'remove'; filter?: string; packages: string[] };

const NonEmptyNoSpaceNoDash = z
	.string()
	.min(1)
	.refine((s) => !/\s/.test(s), 'must not contain spaces')
	.refine((s) => !s.startsWith('-'), "must not start with '-'");

const PackageName = NonEmptyNoSpaceNoDash;
const FilterSelector = NonEmptyNoSpaceNoDash;
const AllowedCmdWord = z.enum(['lint', 'test', 'build']);
const InstallWord = z.enum(['i', 'install']);

export function normalizeRunCmdArgs(input: RunCmdArgs): RunCmdArgs {
	return {
		cmd: input.cmd,
		args: [...input.args],
		cwd: input.cwd,
		timeoutMs: input.timeoutMs,
		env: input.env,
	};
}

export function parseAllowedRunCmd(input: RunCmdArgs): AllowedRunCmd {
	if (input.cmd !== 'pnpm') {
		throw new Error("run_cmd.cmd must be 'pnpm'");
	}

	const args = [...input.args];

	function takeFilterPrefix(xs: string[]): { filter?: string; rest: string[] } {
		if (xs.length >= 2 && xs[0] === '--filter') {
			const selector = FilterSelector.parse(xs[1]);
			return { filter: selector, rest: xs.slice(2) };
		}
		return { rest: xs };
	}

	function takeRecursivePrefix(xs: string[]): { recursive?: boolean; rest: string[] } {
		if (xs.length >= 1 && xs[0] === '-r') {
			return { recursive: true, rest: xs.slice(1) };
		}
		return { rest: xs };
	}

	const filterParsed = takeFilterPrefix(args);
	if (filterParsed.filter) {
		const rest = filterParsed.rest;

		if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
			return { kind: rest[0] as 'lint' | 'test' | 'build', filter: filterParsed.filter };
		}

		if (rest.length === 1 && InstallWord.safeParse(rest[0]).success) {
			return { kind: 'install', filter: filterParsed.filter };
		}

		if (rest.length >= 2 && rest[0] === 'add') {
			const second = rest[1];
			const dev =
				second === '-D' || second === '--save-dev' || second === '--save-dev=true';
			const pkgsStartIndex = dev ? 2 : 1;
			const pkgs = rest.slice(pkgsStartIndex);
			if (pkgs.length === 0) {
				throw new Error('pnpm add requires at least 1 package');
			}
			pkgs.forEach((p) => PackageName.parse(p));
			return { kind: 'add', filter: filterParsed.filter, dev, packages: pkgs };
		}

		if (rest.length >= 2 && rest[0] === 'remove') {
			const pkgs = rest.slice(1);
			pkgs.forEach((p) => PackageName.parse(p));
			return { kind: 'remove', filter: filterParsed.filter, packages: pkgs };
		}

		throw new Error('run_cmd args not in allowlist (filtered)');
	}

	const recParsed = takeRecursivePrefix(args);
	if (recParsed.recursive) {
		const rest = recParsed.rest;
		if (rest.length === 1 && AllowedCmdWord.safeParse(rest[0]).success) {
			return { kind: rest[0] as 'lint' | 'test' | 'build', recursive: true };
		}
		throw new Error('run_cmd args not in allowlist (-r)');
	}

	if (args.length === 1 && AllowedCmdWord.safeParse(args[0]).success) {
		return { kind: args[0] as 'lint' | 'test' | 'build' };
	}

	if (args.length === 1 && InstallWord.safeParse(args[0]).success) {
		return { kind: 'install' };
	}

	if (args.length >= 2 && args[0] === 'add') {
		const second = args[1];
		const dev =
			second === '-D' || second === '--save-dev' || second === '--save-dev=true';
		const pkgsStartIndex = dev ? 2 : 1;
		const pkgs = args.slice(pkgsStartIndex);
		if (pkgs.length === 0) {
			throw new Error('pnpm add requires at least 1 package');
		}
		pkgs.forEach((p) => PackageName.parse(p));
		return { kind: 'add', dev, packages: pkgs };
	}

	if (args.length >= 2 && args[0] === 'remove') {
		const pkgs = args.slice(1);
		pkgs.forEach((p) => PackageName.parse(p));
		return { kind: 'remove', packages: pkgs };
	}

	throw new Error('run_cmd args not in allowlist');
}

export const RunCmdArgsSchema = z.object({
	cmd: z.literal('pnpm'),
	args: z.array(z.string()).min(1),
	cwd: z.string().min(1).optional(),
	timeoutMs: z.number().int().min(1).max(60 * 60 * 1000).optional(),
	env: z.record(z.string()).optional(),
});

export const ToolCall = z.object({
	id: z.string().min(1),
	type: z.literal('function'),
	function: z.object({
		name: ToolName,
		arguments: z.string(),
	}),
});

export type ToolCall = z.infer<typeof ToolCall>;

export const SystemMessage = z.object({
	role: z.literal('system'),
	content: z.string(),
});

export const UserMessage = z.object({
	role: z.literal('user'),
	content: z.string(),
});

export const AssistantTextMessage = z.object({
	role: z.literal('assistant'),
	content: z.string(),
});

export const AssistantToolCallMessage = z.object({
	role: z.literal('assistant'),
	tool_calls: z.array(ToolCall).min(1),
});

export const ToolResultMessage = z.object({
	role: z.literal('tool'),
	tool_call_id: z.string().min(1),
	content: z.string(),
});

export const TrainingMessage = z.union([
	SystemMessage,
	UserMessage,
	AssistantTextMessage,
	AssistantToolCallMessage,
	ToolResultMessage,
]);

export type TrainingMessage = z.infer<typeof TrainingMessage>;

export const TrainingRecord = z.object({
	messages: z.array(TrainingMessage).min(2),
});

export type TrainingRecord = z.infer<typeof TrainingRecord>;

export const StoredSession = z.object({
	id: z.string().uuid(),
	taskId: z.string().min(1),
	repo: z.object({
		name: z.string().min(1),
		root: z.string().min(1),
		branch: z.string().min(1).optional(),
		remote: z.string().min(1).optional(),
	}),
	baseRef: z.string().min(7),
	createdAt: z.string().datetime(),
	record: TrainingRecord,
	metrics: z
		.object({
			filesChanged: z.number().int().min(0).optional(),
			commandsRun: z.array(z.string()).optional(),
		})
		.optional(),
});

export type StoredSession = z.infer<typeof StoredSession>;