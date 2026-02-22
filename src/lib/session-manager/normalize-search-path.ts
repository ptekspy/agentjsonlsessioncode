import * as path from 'node:path';

export function normalizeSearchPath(
	rawPath: string,
	repoRoot: string,
): { recordedPath?: string; grepPath: string } {
	const normalizedInput = rawPath.replace(/\\/g, '/').trim();
	if (!normalizedInput || normalizedInput === '.' || normalizedInput === './') {
		return { grepPath: '.' };
	}

	if (path.isAbsolute(rawPath)) {
		const resolvedRoot = path.resolve(repoRoot);
		const resolvedInput = path.resolve(rawPath);
		const relativeToRoot = path.relative(resolvedRoot, resolvedInput).replace(/\\/g, '/');

		if (!relativeToRoot || relativeToRoot === '.') {
			return { grepPath: '.' };
		}

		if (relativeToRoot.startsWith('..')) {
			throw new Error('Absolute search path must be inside the workspace root.');
		}

		return {
			recordedPath: `./${relativeToRoot}`,
			grepPath: relativeToRoot,
		};
	}

	let relative = normalizedInput;
	relative = relative.replace(/^\.\//, '');
	relative = relative.replace(/^\/+/, '');

	if (!relative || relative === '.') {
		return { grepPath: '.' };
	}

	if (relative.startsWith('..')) {
		throw new Error('Search path must be relative to workspace root (e.g. ./ or ./packages/).');
	}

	return {
		recordedPath: `./${relative}`,
		grepPath: relative,
	};
}
