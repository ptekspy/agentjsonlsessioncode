import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseSearchOutput } from './parse-search-output';
import type { RepoSearchResult } from './search-types';

const execFileAsync = promisify(execFile);

export async function runRepoSearch(
	repoRoot: string,
	query: string,
	searchPath: string,
	maxResults: number,
	isIncludedPath: (filePath: string) => boolean,
): Promise<RepoSearchResult[]> {
	try {
		const { stdout } = await execFileAsync(
			'rg',
			[
				'--line-number',
				'--column',
				'--no-heading',
				'--color',
				'never',
				'--max-count',
				'1',
				query,
				searchPath,
			],
			{
				cwd: repoRoot,
				encoding: 'utf8',
				maxBuffer: 20 * 1024 * 1024,
			},
		);
		return parseSearchOutput(stdout, maxResults, 'rg', isIncludedPath);
	} catch (error) {
		const code =
			error && typeof error === 'object' && 'code' in error
				? (error as { code?: number | string }).code
				: undefined;

		if (code === 1) {
			return [];
		}

		if (code === 'EACCES' || code === 'ENOENT') {
			try {
				const { stdout } = await execFileAsync(
					'git',
					['grep', '-n', '--full-name', '-E', '--', query, searchPath],
					{
						cwd: repoRoot,
						encoding: 'utf8',
						maxBuffer: 20 * 1024 * 1024,
					},
				);
				return parseSearchOutput(stdout, maxResults, 'git-grep', isIncludedPath);
			} catch (fallbackError) {
				const fallbackCode =
					fallbackError && typeof fallbackError === 'object' && 'code' in fallbackError
						? (fallbackError as { code?: number | string }).code
						: undefined;
				if (fallbackCode === 1) {
					return [];
				}
				throw new Error('repo.search failed: rg is unavailable and git grep fallback also failed.');
			}
		}

		if (
			error &&
			typeof error === 'object' &&
			'code' in error &&
			(error as { code?: number | string }).code === 'ENOENT'
		) {
			throw new Error('ripgrep (rg) is not installed or not on PATH. Install rg to use repo.search.');
		}
		throw error;
	}
}
