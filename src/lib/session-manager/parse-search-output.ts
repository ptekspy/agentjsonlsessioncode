import type { RepoSearchResult, RepoSearchSource } from './search-types';

export function parseSearchOutput(
	output: string,
	maxResults: number,
	source: RepoSearchSource,
	isIncludedPath: (filePath: string) => boolean,
): RepoSearchResult[] {
	const parsed: RepoSearchResult[] = [];

	for (const row of output.split('\n')) {
		if (!row.trim()) {
			continue;
		}

		const firstColon = row.indexOf(':');
		if (firstColon <= 0) {
			continue;
		}
		const secondColon = row.indexOf(':', firstColon + 1);
		if (secondColon <= firstColon + 1) {
			continue;
		}

		const filePath = row.slice(0, firstColon);
		if (!isIncludedPath(filePath)) {
			continue;
		}

		const line = Number.parseInt(row.slice(firstColon + 1, secondColon), 10);

		if (source === 'rg') {
			const thirdColon = row.indexOf(':', secondColon + 1);
			if (thirdColon <= secondColon + 1) {
				continue;
			}

			const column = Number.parseInt(row.slice(secondColon + 1, thirdColon), 10);
			const preview = row.slice(thirdColon + 1);
			parsed.push({
				path: filePath,
				line: Number.isFinite(line) && line > 0 ? line : 1,
				column: Number.isFinite(column) && column > 0 ? column : 1,
				preview,
			});
		} else {
			const preview = row.slice(secondColon + 1);
			parsed.push({
				path: filePath,
				line: Number.isFinite(line) && line > 0 ? line : 1,
				column: 1,
				preview,
			});
		}

		if (parsed.length >= maxResults) {
			break;
		}
	}

	return parsed;
}
