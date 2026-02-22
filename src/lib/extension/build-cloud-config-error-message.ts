import * as vscode from 'vscode';

export async function buildCloudConfigErrorMessage(context: vscode.ExtensionContext): Promise<string> {
	const config = vscode.workspace.getConfiguration('dataset');
	const baseUrl = (config.get<string>('apiBaseUrl') ?? '').trim();
	const hasBaseUrl = baseUrl.length > 0;
	const hasToken = Boolean(await context.secrets.get('dataset.apiToken'));

	if (!hasBaseUrl && !hasToken) {
		return 'Missing setup: set dataset.apiBaseUrl and run "Dataset: Set API Token".';
	}

	if (!hasBaseUrl) {
		return 'Missing setup: set dataset.apiBaseUrl (for local server use http://localhost:8787).';
	}

	if (!hasToken) {
		return 'Missing setup: run "Dataset: Set API Token".';
	}

	return 'Cloud connection is not configured correctly.';
}
