import * as vscode from 'vscode';
import { CloudApiClient, type CloudTask } from './lib/cloud-api';
import { SessionManager } from './lib/session-manager';
import { DatasetSidebarProvider } from './sidebar/dataset-sidebar';

export function activate(context: vscode.ExtensionContext) {
	const sessionManager = new SessionManager();
	let cachedTasks: CloudTask[] = [];
	const getSidebarState = () => ({
		taskId: context.workspaceState.get<string>('dataset.taskId') ?? 'default',
		isSessionActive: sessionManager.hasActiveSession(),
		lastRecordPath: context.globalState.get<string>('dataset.lastRecordPath'),
	});

	const sidebarProvider = new DatasetSidebarProvider(context.extensionUri, getSidebarState);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DatasetSidebarProvider.viewType, sidebarProvider),
	);

	const refreshSidebar = () => sidebarProvider.refresh();

	const loadCloudTasks = async (): Promise<CloudTask[]> => {
		const api = await getCloudApiClient(context);
		if (!api) {
			cachedTasks = [];
			return [];
		}

		const tasks = await api.getTasks();
		cachedTasks = tasks;
		await context.globalState.update('dataset.tasks', tasks);
		return tasks;
	};

	void (async () => {
		try {
			const api = await getCloudApiClient(context);
			if (!api) {
				return;
			}
			await api.health();
			await loadCloudTasks();
			refreshSidebar();
		} catch (error) {
			vscode.window.showWarningMessage(`Dataset cloud unavailable: ${toErrorMessage(error)}`);
		}
	})();

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.selectTask', async () => {
			let tasks = cachedTasks;
			if (tasks.length === 0) {
				try {
					tasks = await loadCloudTasks();
				} catch {
					tasks = [];
				}
			}

			const items: vscode.QuickPickItem[] =
				tasks.length > 0
					? tasks.map((task) => ({
							label: task.id,
							description: task.name,
							detail: task.description ?? undefined,
					  }))
					: [
							{ label: 'default', description: 'Local task id' },
							{ label: 'rsc-convert', description: 'Example task id' },
							{ label: 'tailwind-setup', description: 'Example task id' },
					  ];

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a task id for this workspace',
			});

			if (!selected) {
				return;
			}

			await context.workspaceState.update('dataset.taskId', selected.label);
			vscode.window.showInformationMessage(`Dataset task selected: ${selected.label}`);
			refreshSidebar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.createTask', async () => {
			const taskId = await vscode.window.showInputBox({
				prompt: 'Enter new task id (slug)',
				placeHolder: 'rsc-convert',
				ignoreFocusOut: true,
				validateInput: (value) => {
					if (!value.trim()) {
						return 'Task id is required';
					}
					return undefined;
				},
			});

			if (!taskId) {
				return;
			}

			const taskName = await vscode.window.showInputBox({
				prompt: 'Enter task display name',
				value: taskId,
				ignoreFocusOut: true,
			});

			if (!taskName) {
				return;
			}

			const description = await vscode.window.showInputBox({
				prompt: 'Optional task description',
				ignoreFocusOut: true,
			});

			const api = await getCloudApiClient(context);
			if (api) {
				await api.createTask({
					id: taskId,
					name: taskName,
					description: description || undefined,
				});
				await loadCloudTasks();
			}

			await context.workspaceState.update('dataset.taskId', taskId);
			vscode.window.showInformationMessage(`Dataset task created: ${taskId}`);
			refreshSidebar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.setApiToken', async () => {
			const token = await vscode.window.showInputBox({
				prompt: 'Set dataset API token',
				password: true,
				ignoreFocusOut: true,
			});

			if (!token) {
				return;
			}

			await context.secrets.store('dataset.apiToken', token);
			vscode.window.showInformationMessage('Dataset API token saved in SecretStorage.');
			refreshSidebar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.startSession', async () => {
			try {
				const taskId =
					(context.workspaceState.get<string>('dataset.taskId') ?? '').trim() || 'default';

				const systemPrompt =
					(await vscode.window.showInputBox({
						prompt: 'System prompt for this session',
						value: 'You are an expert coding assistant.',
						ignoreFocusOut: true,
					})) ?? '';

				if (!systemPrompt) {
					return;
				}

				const userPrompt =
					(await vscode.window.showInputBox({
						prompt: 'User prompt for this session',
						value: 'Implement the requested change.',
						ignoreFocusOut: true,
					})) ?? '';

				if (!userPrompt) {
					return;
				}

				await sessionManager.startSession(taskId, systemPrompt, userPrompt);
				vscode.window.showInformationMessage('Dataset session started.');
				refreshSidebar();
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.stopSessionUpload', async () => {
			try {
				const result = await sessionManager.stopAndBuildLocalRecord(context);
				const api = await getCloudApiClient(context);
				if (api) {
					const upload = await api.createSession(result.payload);
					vscode.window.showInformationMessage(
						`Session uploaded (${upload.sessionId}) and saved locally: ${result.outputPath}`,
					);
				} else {
					vscode.window.showInformationMessage(`Session record saved: ${result.outputPath}`);
				}
				refreshSidebar();
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.discardSession', () => {
			sessionManager.discardSession();
			vscode.window.showInformationMessage('Dataset session discarded.');
			refreshSidebar();
		}),
	);
}

export function deactivate() {}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}

async function getCloudApiClient(
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
