import * as vscode from 'vscode';
import { CloudApiClient } from '../cloud-api';
import type { CloudConnectionStatus } from './cloud-connection-status';

export async function getCloudConnectionStatus(
	context: vscode.ExtensionContext,
): Promise<CloudConnectionStatus> {
	const config = vscode.workspace.getConfiguration('dataset');
	const baseUrl = (config.get<string>('apiBaseUrl') ?? '').trim();
	if (!baseUrl) {
		return 'url-missing';
	}

	const token = await context.secrets.get('dataset.apiToken');
	if (!token) {
		return 'token-missing';
	}

	try {
		const api = new CloudApiClient({ baseUrl, token });
		await api.health();
		return 'connected';
	} catch {
		return 'unreachable';
	}
}
