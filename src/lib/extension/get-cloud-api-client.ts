import * as vscode from 'vscode';
import { CloudApiClient } from '../cloud-api';

export async function getCloudApiClient(
	context: vscode.ExtensionContext,
): Promise<CloudApiClient | undefined> {
	const config = vscode.workspace.getConfiguration('dataset');
	const baseUrl = (config.get<string>('apiBaseUrl') ?? '').trim();
	if (!baseUrl) {
		return undefined;
	}

	const token = await context.secrets.get('dataset.apiToken');
	if (!token) {
		return undefined;
	}

	return new CloudApiClient({
		baseUrl,
		token,
	});
}
