import * as vscode from 'vscode';
import { promptForApiBaseUrl } from './prompt-for-api-base-url';
import { promptForApiToken } from './prompt-for-api-token';

export async function ensureCloudConfiguration(
	context: vscode.ExtensionContext,
	mode: 'check' | 'setup' = 'check',
): Promise<void> {
	const config = vscode.workspace.getConfiguration('dataset');
	const currentBaseUrl = (config.get<string>('apiBaseUrl') ?? '').trim();
	if (!currentBaseUrl) {
		const baseUrl = await promptForApiBaseUrl();
		if (!baseUrl) {
			throw new Error(
				mode === 'setup'
					? 'Cloud setup canceled: API base URL is required.'
					: 'Cloud check canceled: API base URL is required.',
			);
		}
		await config.update('apiBaseUrl', baseUrl, vscode.ConfigurationTarget.Global);
	}

	const currentToken = await context.secrets.get('dataset.apiToken');
	if (!currentToken) {
		const normalizedToken = await promptForApiToken();
		if (!normalizedToken) {
			throw new Error(
				mode === 'setup'
					? 'Cloud setup canceled: API token is required.'
					: 'Cloud check canceled: API token is required.',
			);
		}
		await context.secrets.store('dataset.apiToken', normalizedToken);
	}
}
