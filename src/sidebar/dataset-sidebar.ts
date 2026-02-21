import * as vscode from 'vscode';

export type SidebarState = {
	taskId: string;
	isSessionActive: boolean;
	lastRecordPath?: string;
};

type SidebarAction =
	| { type: 'ready' }
	| { type: 'selectTask' }
	| { type: 'createTask' }
	| { type: 'setApiToken' }
	| { type: 'startSession' }
	| { type: 'stopSessionUpload' }
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
			case 'setApiToken':
			case 'startSession':
			case 'stopSessionUpload':
			case 'discardSession':
				return { type: maybeType };
			default:
				return undefined;
		}
	}

	private async handleAction(action: SidebarAction): Promise<void> {
		if (action.type === 'ready') {
			this.refresh();
			return;
		}

		const commandByAction: Record<Exclude<SidebarAction['type'], 'ready'>, string> = {
			selectTask: 'dataset.selectTask',
			createTask: 'dataset.createTask',
			setApiToken: 'dataset.setApiToken',
			startSession: 'dataset.startSession',
			stopSessionUpload: 'dataset.stopSessionUpload',
			discardSession: 'dataset.discardSession',
		};

		await vscode.commands.executeCommand(commandByAction[action.type]);
		this.refresh();
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