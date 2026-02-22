import * as vscode from 'vscode';

export function getSingleWorkspaceFolder(): vscode.WorkspaceFolder {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		throw new Error('Open a workspace folder to use dataset tools.');
	}
	return folder;
}
