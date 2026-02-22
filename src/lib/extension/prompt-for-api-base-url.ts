import * as vscode from 'vscode';

export async function promptForApiBaseUrl(): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('dataset');
	const currentValue = (config.get<string>('apiBaseUrl') ?? '').trim();
	const baseUrl = await vscode.window.showInputBox({
		prompt: 'Set dataset API base URL',
		value: currentValue || 'http://localhost:8787',
		ignoreFocusOut: true,
	});

	const normalized = baseUrl?.trim();
	if (!normalized) {
		return undefined;
	}

	if (!/^https?:\/\//i.test(normalized)) {
		throw new Error('Invalid API base URL. Include http:// or https://');
	}

	return normalized;
}
