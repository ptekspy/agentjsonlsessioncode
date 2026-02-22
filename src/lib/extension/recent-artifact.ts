export type RecentArtifact = {
	type: 'session' | 'export';
	path: string;
	createdAt: string;
	status?: 'draft' | 'ready';
	cloudSessionId?: string;
};
