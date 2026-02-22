export type RepoSearchResult = {
	path: string;
	line: number;
	column: number;
	preview: string;
};

export type RepoSearchSource = 'rg' | 'git-grep';
