import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function listFilesRecursively(directoryPath: string, workspaceRoot: string): Promise<string[]> {
	const stack = [directoryPath];
	const files: string[] = [];

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}

		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(fullPath);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}

			const relative = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
			if (!relative || relative.startsWith('..')) {
				continue;
			}
			files.push(relative);
		}
	}

	files.sort((left, right) => left.localeCompare(right));
	return files;
}
