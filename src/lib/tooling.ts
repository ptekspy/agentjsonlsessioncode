export type ToolName = 'repo.readFile' | 'repo.search' | 'repo.listTree' | 'run_cmd' | 'apply_patch';

export type RepoReadFileArgs = {
	path: string;
};

export type ApplyPatchOperation =
	| {
			type: 'create_file';
			path: string;
			diff: string;
	  }
	| {
			type: 'update_file';
			path: string;
			diff: string;
	  }
	| {
			type: 'delete_file';
			path: string;
	  };

export type ApplyPatchArgs = {
	data: {
		action: {
			operations: ApplyPatchOperation[];
		};
	};
};

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

function assertNonEmptyNoSpaceNoDash(value: string, label: string): void {
	if (!value || /\s/.test(value) || value.startsWith('-')) {
		throw new Error(`${label} must be non-empty, contain no spaces, and not start with '-'.`);
	}
}

function isAllowedCmdWord(value: string): value is 'lint' | 'test' | 'build' {
	return value === 'lint' || value === 'test' || value === 'build';
}

function isInstallWord(value: string): value is 'i' | 'install' {
	return value === 'i' || value === 'install';
}

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
			const selector = xs[1];
			assertNonEmptyNoSpaceNoDash(selector, 'filter');
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

		if (rest.length === 1 && isAllowedCmdWord(rest[0])) {
			return { kind: rest[0] as 'lint' | 'test' | 'build', filter: filterParsed.filter };
		}

		if (rest.length === 1 && isInstallWord(rest[0])) {
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
			pkgs.forEach((pkg) => assertNonEmptyNoSpaceNoDash(pkg, 'package'));
			return { kind: 'add', filter: filterParsed.filter, dev, packages: pkgs };
		}

		if (rest.length >= 2 && rest[0] === 'remove') {
			const pkgs = rest.slice(1);
			pkgs.forEach((pkg) => assertNonEmptyNoSpaceNoDash(pkg, 'package'));
			return { kind: 'remove', filter: filterParsed.filter, packages: pkgs };
		}

		throw new Error('run_cmd args not in allowlist (filtered)');
	}

	const recParsed = takeRecursivePrefix(args);
	if (recParsed.recursive) {
		const rest = recParsed.rest;
		if (rest.length === 1 && isAllowedCmdWord(rest[0])) {
			return { kind: rest[0] as 'lint' | 'test' | 'build', recursive: true };
		}
		throw new Error('run_cmd args not in allowlist (-r)');
	}

	if (args.length === 1 && isAllowedCmdWord(args[0])) {
		return { kind: args[0] as 'lint' | 'test' | 'build' };
	}

	if (args.length === 1 && isInstallWord(args[0])) {
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
		pkgs.forEach((pkg) => assertNonEmptyNoSpaceNoDash(pkg, 'package'));
		return { kind: 'add', dev, packages: pkgs };
	}

	if (args.length >= 2 && args[0] === 'remove') {
		const pkgs = args.slice(1);
		pkgs.forEach((pkg) => assertNonEmptyNoSpaceNoDash(pkg, 'package'));
		return { kind: 'remove', packages: pkgs };
	}

	throw new Error('run_cmd args not in allowlist');
}

export type ToolCall = {
	id: string;
	type: 'function';
	function: {
		name: ToolName;
		arguments: string;
	};
};

export type SystemMessage = {
	role: 'system';
	content: string;
};

export type UserMessage = {
	role: 'user';
	content: string;
};

export type AssistantTextMessage = {
	role: 'assistant';
	content: string;
};

export type AssistantToolCallMessage = {
	role: 'assistant';
	tool_calls: ToolCall[];
};

export type ToolResultMessage = {
	role: 'tool';
	tool_call_id: string;
	content: string;
};

export type TrainingMessage =
	| SystemMessage
	| UserMessage
	| AssistantTextMessage
	| AssistantToolCallMessage
	| ToolResultMessage;

export type TrainingRecord = {
	messages: TrainingMessage[];
};

export type StoredSession = {
	id: string;
	taskId: string;
	repo: {
		name: string;
		root: string;
		branch?: string;
		remote?: string;
	};
	baseRef: string;
	createdAt: string;
	record: TrainingRecord;
	metrics?: {
		filesChanged?: number;
		commandsRun?: string[];
	};
};