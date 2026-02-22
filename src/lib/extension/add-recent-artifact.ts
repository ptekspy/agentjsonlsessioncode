import * as vscode from 'vscode';
import type { RecentArtifact } from './recent-artifact';

export async function addRecentArtifact(
	context: vscode.ExtensionContext,
	artifact: RecentArtifact,
): Promise<void> {
	const current = context.globalState.get<RecentArtifact[]>('dataset.recentArtifacts') ?? [];
	const deduped = current.filter((entry) => entry.path !== artifact.path);
	const next = [artifact, ...deduped].slice(0, 5);
	await context.globalState.update('dataset.recentArtifacts', next);
}
