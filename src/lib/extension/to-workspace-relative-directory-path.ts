import * as path from 'node:path';

export function toWorkspaceRelativeDirectoryPath(
	workspaceRoot: string,
	absoluteDirectoryPath: string,
): string {
	const relative = path.relative(workspaceRoot, absoluteDirectoryPath).replace(/\\/g, '/');
	if (!relative || relative === '.') {
		return '.';
	}
	return `./${relative}`;
}
