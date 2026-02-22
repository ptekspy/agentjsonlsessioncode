import * as vscode from 'vscode';

export async function promptForApiToken(): Promise<string | undefined> {
	const token = await vscode.window.showInputBox({
		prompt: 'Set dataset API token',
		password: true,
		ignoreFocusOut: true,
	});

	const normalizedToken = token?.trim();
	if (!normalizedToken) {
		return undefined;
	}

	return normalizedToken;
}
