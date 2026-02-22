import * as path from 'node:path';

export function resolveWorkspaceDirectoryPath(workspaceRoot: string, rawPath: string): string {
	const trimmed = rawPath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
	if (!trimmed || trimmed === '.') {
		return workspaceRoot;
	}

	const resolved = path.resolve(workspaceRoot, trimmed);
	const normalizedRoot = path.resolve(workspaceRoot);
	const withSep = `${normalizedRoot}${path.sep}`;
	if (resolved !== normalizedRoot && !resolved.startsWith(withSep)) {
		throw new Error('Path must be inside the workspace root.');
	}

	return resolved;
}
