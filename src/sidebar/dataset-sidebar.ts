import * as vscode from 'vscode';

export type SidebarState = {
	taskId: string;
	isSessionActive: boolean;
	defaultSystemPrompt?: string;
	lastRecordPath?: string;
	lastSessionStatus?: 'draft' | 'ready';
	cloudStatus?: 'connected' | 'url-missing' | 'token-missing' | 'unreachable';
	isCloudChecking?: boolean;
	lastCloudCheckAt?: string;
	lastSessionSummary?: {
		filesChanged: number;
		commandsRecorded: number;
	};
	recentArtifacts?: Array<{
		type: 'session' | 'export';
		path: string;
		createdAt: string;
		status?: 'draft' | 'ready';
		cloudSessionId?: string;
	}>;
};

type SidebarAction =
	| { type: 'ready' }
	| { type: 'selectTask' }
	| { type: 'createTask' }
	| { type: 'setupCloud' }
	| { type: 'setApiBaseUrl' }
	| { type: 'setApiToken' }
	| { type: 'checkCloudConnection' }
	| { type: 'syncLocalSessions' }
	| {
			type: 'startSession';
			payload?: {
				systemPrompt?: string;
				userPrompt?: string;
			};
	  }
	| { type: 'submitFileChanges' }
	| { type: 'stopSessionUpload' }
	| {
			type: 'runPnpmCommand';
			payload: {
				preset: 'install' | 'add' | 'addDev' | 'remove' | 'lint' | 'test' | 'build';
				filter?: string;
				packages?: string;
				timeoutMs?: number;
			};
	  }
	| {
			type: 'searchRepo';
			payload: {
				query?: string;
			};
	  }
	| {
			type: 'exportTaskJsonl';
			payload: {
				since?: string;
				limit?: number;
			};
	  }
	| { type: 'importJsonlUpdates' }
	| { type: 'openRecentArtifact'; payload: { path: string } }
	| { type: 'deleteRecentArtifact'; payload: { path: string } }
	| { type: 'discardSession' };

export class DatasetSidebarProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'dataset.sidebarView';

	private view: vscode.WebviewView | undefined;
	private readonly extensionUri: vscode.Uri;
	private readonly getState: () => SidebarState;

	public constructor(extensionUri: vscode.Uri, getState: () => SidebarState) {
		this.extensionUri = extensionUri;
		this.getState = getState;
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;
		const webview = webviewView.webview;
		webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
		};

		webview.html = this.getHtml(webview, this.extensionUri);

		webview.onDidReceiveMessage((raw: unknown) => {
			const action = this.parseAction(raw);
			if (!action) {
				return;
			}
			void this.handleAction(action);
		});
	}

	public refresh(): void {
		if (!this.view) {
			return;
		}
		void this.view.webview.postMessage({
			type: 'state',
			payload: this.getState(),
		});
	}

	private parseAction(raw: unknown): SidebarAction | undefined {
		if (!raw || typeof raw !== 'object') {
			return undefined;
		}

		const maybeType = (raw as { type?: unknown }).type;
		if (typeof maybeType !== 'string') {
			return undefined;
		}

		switch (maybeType) {
			case 'ready':
			case 'selectTask':
			case 'createTask':
			case 'setupCloud':
			case 'setApiBaseUrl':
			case 'setApiToken':
			case 'checkCloudConnection':
			case 'syncLocalSessions':
			case 'startSession':
			case 'submitFileChanges':
			case 'stopSessionUpload':
			case 'runPnpmCommand':
			case 'searchRepo':
			case 'exportTaskJsonl':
			case 'importJsonlUpdates':
			case 'openRecentArtifact':
			case 'deleteRecentArtifact':
			case 'discardSession':
				if (maybeType === 'startSession') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return { type: 'startSession' };
					}

					const typed = payload as { systemPrompt?: unknown; userPrompt?: unknown };
					return {
						type: 'startSession',
						payload: {
							systemPrompt:
								typeof typed.systemPrompt === 'string' ? typed.systemPrompt : undefined,
							userPrompt: typeof typed.userPrompt === 'string' ? typed.userPrompt : undefined,
						},
					};
				}

				if (maybeType === 'runPnpmCommand') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return undefined;
					}
					const typed = payload as {
						preset?: unknown;
						filter?: unknown;
						packages?: unknown;
						timeoutMs?: unknown;
					};
					if (
						typed.preset !== 'install' &&
						typed.preset !== 'add' &&
						typed.preset !== 'addDev' &&
						typed.preset !== 'remove' &&
						typed.preset !== 'lint' &&
						typed.preset !== 'test' &&
						typed.preset !== 'build'
					) {
						return undefined;
					}
					return {
						type: 'runPnpmCommand',
						payload: {
							preset: typed.preset,
							filter: typeof typed.filter === 'string' ? typed.filter : undefined,
							packages: typeof typed.packages === 'string' ? typed.packages : undefined,
							timeoutMs: typeof typed.timeoutMs === 'number' ? typed.timeoutMs : undefined,
						},
					};
				}
				if (maybeType === 'searchRepo') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return { type: 'searchRepo', payload: {} };
					}
					const typed = payload as { query?: unknown };
					return {
						type: 'searchRepo',
						payload: {
							query: typeof typed.query === 'string' ? typed.query : undefined,
						},
					};
				}
				if (maybeType === 'exportTaskJsonl') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return { type: 'exportTaskJsonl', payload: {} };
					}
					const typed = payload as {
						since?: unknown;
						limit?: unknown;
					};
					return {
						type: 'exportTaskJsonl',
						payload: {
							since: typeof typed.since === 'string' ? typed.since : undefined,
							limit: typeof typed.limit === 'number' ? typed.limit : undefined,
						},
					};
				}
				if (maybeType === 'openRecentArtifact') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return undefined;
					}
					const path = (payload as { path?: unknown }).path;
					if (typeof path !== 'string' || path.length === 0) {
						return undefined;
					}
					return { type: 'openRecentArtifact', payload: { path } };
				}
				if (maybeType === 'deleteRecentArtifact') {
					const payload = (raw as { payload?: unknown }).payload;
					if (!payload || typeof payload !== 'object') {
						return undefined;
					}
					const path = (payload as { path?: unknown }).path;
					if (typeof path !== 'string' || path.length === 0) {
						return undefined;
					}
					return { type: 'deleteRecentArtifact', payload: { path } };
				}
				return { type: maybeType };
			default:
				return undefined;
		}
	}

	private async handleAction(action: SidebarAction): Promise<void> {
		try {
			if (action.type === 'ready') {
				this.refresh();
				return;
			}

			if (action.type === 'runPnpmCommand') {
				await vscode.commands.executeCommand('dataset.runPnpmCommand', action.payload);
				this.refresh();
				return;
			}

			if (action.type === 'searchRepo') {
				await vscode.commands.executeCommand('dataset.searchRepo', action.payload);
				this.refresh();
				return;
			}

			if (action.type === 'exportTaskJsonl') {
				await vscode.commands.executeCommand('dataset.exportTaskJsonl', action.payload);
				this.refresh();
				return;
			}

			if (action.type === 'importJsonlUpdates') {
				await vscode.commands.executeCommand('dataset.importJsonlUpdates');
				this.refresh();
				return;
			}

			if (action.type === 'openRecentArtifact') {
				await vscode.commands.executeCommand('dataset.openRecentArtifact', action.payload.path);
				return;
			}

			if (action.type === 'deleteRecentArtifact') {
				await vscode.commands.executeCommand('dataset.deleteRecentArtifact', action.payload.path);
				this.refresh();
				return;
			}

			if (action.type === 'startSession') {
				await vscode.commands.executeCommand('dataset.startSession', action.payload);
				this.refresh();
				return;
			}

			const commandByAction: Record<Exclude<SidebarAction['type'], 'ready' | 'runPnpmCommand' | 'searchRepo' | 'exportTaskJsonl' | 'importJsonlUpdates' | 'openRecentArtifact' | 'deleteRecentArtifact' | 'startSession'>, string> = {
				selectTask: 'dataset.selectTask',
				createTask: 'dataset.createTask',
				setupCloud: 'dataset.setupCloud',
				setApiBaseUrl: 'dataset.setApiBaseUrl',
				setApiToken: 'dataset.setApiToken',
				checkCloudConnection: 'dataset.checkCloudConnection',
				syncLocalSessions: 'dataset.syncLocalSessions',
				submitFileChanges: 'dataset.submitFileChanges',
				stopSessionUpload: 'dataset.stopSessionUpload',
				discardSession: 'dataset.discardSession',
			};

			await vscode.commands.executeCommand(commandByAction[action.type]);
			this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown command error';
			vscode.window.showErrorMessage(`Sidebar action failed: ${message}`);
		}
	}

	private getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'media', 'webview.js'),
		);
		const nonce = createNonce();
		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} https: data:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`script-src 'nonce-${nonce}'`,
		].join('; ');

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Session Recorder</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}