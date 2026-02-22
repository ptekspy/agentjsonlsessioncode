import type { RunCmdArgs } from '../tooling';

export function buildRunCmdArgs(input: {
	preset: 'install' | 'add' | 'addDev' | 'remove' | 'lint' | 'test' | 'build';
	filter?: string;
	packages?: string;
	timeoutMs?: number;
}): RunCmdArgs {
	const args: string[] = [];
	const filter = (input.filter ?? '').trim();
	if (filter) {
		args.push('--filter', filter);
	}

	const packages = (input.packages ?? '')
		.split(/\s+/)
		.map((pkg) => pkg.trim())
		.filter(Boolean);

	switch (input.preset) {
		case 'install':
			args.push('i');
			break;
		case 'add':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm add.');
			}
			args.push('add', ...packages);
			break;
		case 'addDev':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm add -D.');
			}
			args.push('add', '-D', ...packages);
			break;
		case 'remove':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm remove.');
			}
			args.push('remove', ...packages);
			break;
		case 'lint':
		case 'test':
		case 'build':
			args.push(input.preset);
			break;
	}

	return {
		cmd: 'pnpm',
		args,
		timeoutMs: input.timeoutMs,
	};
}
