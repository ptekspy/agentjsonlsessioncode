import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CloudApiClient, type CloudTask } from './lib/cloud-api';
import { SessionManager, type BuiltSessionResult } from './lib/session-manager';
import type { RunCmdArgs } from './lib/tooling';
import { DatasetSidebarProvider } from './sidebar/dataset-sidebar';

type CloudConnectionStatus =
	| 'connected'
	| 'url-missing'
	| 'token-missing'
	| 'unreachable';

type RecentArtifact = {
	type: 'session' | 'export';
	path: string;
	createdAt: string;
	status?: 'draft' | 'ready';
};

export function activate(context: vscode.ExtensionContext) {
	const sessionManager = new SessionManager();
	let cachedTasks: CloudTask[] = [];
	let cloudStatus: CloudConnectionStatus = 'url-missing';
	let isCloudChecking = false;
	let lastCloudCheckAt: string | undefined;
	const getSidebarState = () => ({
		taskId: context.workspaceState.get<string>('dataset.taskId') ?? 'default',
		isSessionActive: sessionManager.hasActiveSession(),
		lastRecordPath: context.globalState.get<string>('dataset.lastRecordPath'),
		lastSessionStatus: context.globalState.get<'draft' | 'ready'>('dataset.lastSessionStatus'),
		lastSessionSummary: context.globalState.get<{
			filesChanged: number;
			commandsRecorded: number;
		}>('dataset.lastSessionSummary'),
		cloudStatus,
		isCloudChecking,
		lastCloudCheckAt,
		recentArtifacts: context.globalState.get<RecentArtifact[]>('dataset.recentArtifacts') ?? [],
	});

	const sidebarProvider = new DatasetSidebarProvider(context.extensionUri, getSidebarState);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(DatasetSidebarProvider.viewType, sidebarProvider),
	);

	const refreshSidebar = () => sidebarProvider.refresh();

	const refreshCloudStatus = async () => {
		cloudStatus = await getCloudConnectionStatus(context);
		refreshSidebar();
	};

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
				await refreshCloudStatus();
				return;
			}
			await api.health();
			cloudStatus = 'connected';
			lastCloudCheckAt = new Date().toISOString();
			await loadCloudTasks();
			refreshSidebar();
		} catch (error) {
			cloudStatus = 'unreachable';
			lastCloudCheckAt = new Date().toISOString();
			refreshSidebar();
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
			const token = await promptForApiToken();

			if (!token) {
				return;
			}

			await context.secrets.store('dataset.apiToken', token);
			await refreshCloudStatus();
			vscode.window.showInformationMessage('Dataset API token saved in SecretStorage.');
			refreshSidebar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.setupCloud', async () => {
			try {
				await ensureCloudConfiguration(context, 'setup');
				await refreshCloudStatus();
				vscode.window.showInformationMessage('Cloud setup saved. You can now run Check Cloud Connection.');
				refreshSidebar();
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.setApiBaseUrl', async () => {
			const baseUrl = await promptForApiBaseUrl();
			if (!baseUrl) {
				return;
			}

			const config = vscode.workspace.getConfiguration('dataset');
			await config.update('apiBaseUrl', baseUrl.trim(), vscode.ConfigurationTarget.Global);
			await refreshCloudStatus();
			vscode.window.showInformationMessage(`Dataset API base URL set: ${baseUrl.trim()}`);
			refreshSidebar();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.checkCloudConnection', async () => {
			isCloudChecking = true;
			refreshSidebar();
			try {
				await ensureCloudConfiguration(context);
				const api = await getCloudApiClient(context);
				if (!api) {
					await refreshCloudStatus();
					throw new Error(await buildCloudConfigErrorMessage(context));
				}

				await api.health();
				cloudStatus = 'connected';
				lastCloudCheckAt = new Date().toISOString();
				await loadCloudTasks();
				refreshSidebar();
				vscode.window.showInformationMessage('Cloud connection is healthy and tasks were refreshed.');
			} catch (error) {
				cloudStatus = 'unreachable';
				lastCloudCheckAt = new Date().toISOString();
				refreshSidebar();
				vscode.window.showErrorMessage(`Cloud check failed: ${toErrorMessage(error)}`);
			} finally {
				isCloudChecking = false;
				refreshSidebar();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.openRecentArtifact', async (artifactPath: string) => {
			if (!artifactPath || typeof artifactPath !== 'string') {
				return;
			}
			await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(artifactPath));
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
		vscode.commands.registerCommand(
			'dataset.runPnpmCommand',
			async (input: {
				preset: 'install' | 'add' | 'addDev' | 'remove' | 'lint' | 'test' | 'build';
				filter?: string;
				packages?: string;
				timeoutMs?: number;
			}) => {
				try {
					const runArgs = buildRunCmdArgs(input);
					const output = await sessionManager.runAllowedPnpmCommand(runArgs);
					vscode.window.showInformationMessage(
						`Recorded command: pnpm ${runArgs.args.join(' ')} (${summarizeOutput(output)})`,
					);
					refreshSidebar();
				} catch (error) {
					vscode.window.showErrorMessage(toErrorMessage(error));
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.stopSessionUpload', async () => {
			try {
				const result = await sessionManager.stopAndBuildLocalRecord(context);
				await addRecentArtifact(context, {
					type: 'session',
					path: result.outputPath,
					createdAt: new Date().toISOString(),
					status: result.payload.status,
				});
				await context.globalState.update('dataset.lastSessionStatus', result.payload.status);
				await context.globalState.update('dataset.lastSessionSummary', {
					filesChanged: result.payload.metrics.filesChanged,
					commandsRecorded: result.payload.metrics.commandsRun.length,
				});
				const uploadMode = vscode.workspace
					.getConfiguration('dataset')
					.get<'full' | 'metadataOnly'>('uploadMode', 'full');
				const warningThreshold = vscode.workspace
					.getConfiguration('dataset')
					.get<number>('maxChangedFilesWarning', 50);
				if (result.payload.metrics.filesChanged > warningThreshold) {
					vscode.window.showWarningMessage(
						`Large session detected (${result.payload.metrics.filesChanged} changed files). Consider smaller sessions for cleaner training data.`,
					);
				}
				const api = await getCloudApiClient(context);
				if (api) {
					const uploadPayload = buildUploadPayload(result, uploadMode);
					const upload = await api.createSession(uploadPayload);
					cloudStatus = 'connected';
					lastCloudCheckAt = new Date().toISOString();
					refreshSidebar();
					vscode.window.showInformationMessage(
						`Session uploaded (${upload.sessionId}, ${uploadPayload.status}, mode=${uploadMode}) and saved locally: ${result.outputPath}`,
					);
				} else {
					await refreshCloudStatus();
					vscode.window.showInformationMessage(
						`Session record saved (${result.payload.status}): ${result.outputPath}`,
					);
				}
				refreshSidebar();
			} catch (error) {
				if (toErrorMessage(error).includes('API')) {
					cloudStatus = 'unreachable';
					lastCloudCheckAt = new Date().toISOString();
					refreshSidebar();
				}
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dataset.exportTaskJsonl',
			async (input?: { since?: string; limit?: number }) => {
			try {
				const taskId =
					(context.workspaceState.get<string>('dataset.taskId') ?? '').trim() || 'default';
				const api = await getCloudApiClient(context);
				if (!api) {
					await refreshCloudStatus();
					throw new Error('Set dataset.apiBaseUrl and Dataset API token before exporting.');
				}

				const since = (input?.since ?? '').trim();
				const limit =
					typeof input?.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
						? Math.floor(input.limit)
						: undefined;

				const jsonl = await api.exportTaskJsonl({
					taskId,
					since: since || undefined,
					limit,
				});
				const folder = vscode.workspace.workspaceFolders?.[0];
				if (!folder) {
					throw new Error('No workspace folder available for export output.');
				}

				const exportDir = path.join(folder.uri.fsPath, '.agent-dataset', 'exports');
				await fs.mkdir(exportDir, { recursive: true });
				const outputPath = path.join(
					exportDir,
					`${taskId}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`,
				);
				await fs.writeFile(outputPath, jsonl, 'utf8');
				await addRecentArtifact(context, {
					type: 'export',
					path: outputPath,
					createdAt: new Date().toISOString(),
				});

				await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(outputPath));
				cloudStatus = 'connected';
				lastCloudCheckAt = new Date().toISOString();
				vscode.window.showInformationMessage(`Task export saved: ${outputPath}`);
			} catch (error) {
				if (toErrorMessage(error).includes('API')) {
					cloudStatus = 'unreachable';
					lastCloudCheckAt = new Date().toISOString();
					refreshSidebar();
				}
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.discardSession', () => {
			sessionManager.discardSession();
			vscode.window.showInformationMessage('Dataset session discarded.');
			refreshSidebar();
		}),
	);
}

function buildUploadPayload(
	result: BuiltSessionResult,
	uploadMode: 'full' | 'metadataOnly',
): BuiltSessionResult['payload'] {
	if (uploadMode === 'full') {
		return result.payload;
	}

	const baseMessages = result.payload.record.messages.filter(
		(message) => message.role === 'system' || message.role === 'user',
	);

	const metadataRecord = {
		messages: [
			...baseMessages,
			{
				role: 'assistant' as const,
				content: 'Metadata-only upload mode enabled; tool traces and file contents were omitted.',
			},
		],
	};

	return {
		...result.payload,
		repo: {
			...result.payload.repo,
			root: '[redacted-local-path]',
			remote: undefined,
		},
		metrics: {
			filesChanged: result.payload.metrics.filesChanged,
			commandsRun: [],
		},
		status: 'draft',
		record: metadataRecord,
	};
}

export function deactivate() {}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return 'Unknown error';
}

function buildRunCmdArgs(input: {
	preset: 'install' | 'add' | 'addDev' | 'remove' | 'lint' | 'test' | 'build';
	filter?: string;
	packages?: string;
	timeoutMs?: number;
}): RunCmdArgs {
	const args: string[] = [];
	const filter = (input.filter ?? '').trim();
	if (filter) {
		args.push('--filter', filter);
	}

	const packages = (input.packages ?? '')
		.split(/\s+/)
		.map((pkg) => pkg.trim())
		.filter(Boolean);

	switch (input.preset) {
		case 'install':
			args.push('i');
			break;
		case 'add':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm add.');
			}
			args.push('add', ...packages);
			break;
		case 'addDev':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm add -D.');
			}
			args.push('add', '-D', ...packages);
			break;
		case 'remove':
			if (packages.length === 0) {
				throw new Error('Provide at least one package for pnpm remove.');
			}
			args.push('remove', ...packages);
			break;
		case 'lint':
		case 'test':
		case 'build':
			args.push(input.preset);
			break;
	}

	return {
		cmd: 'pnpm',
		args,
		timeoutMs: input.timeoutMs,
	};
}

function summarizeOutput(output: string): string {
	const line = output.split('\n').map((v) => v.trim()).find((v) => v.length > 0);
	if (!line) {
		return 'no output';
	}
	return line.length > 80 ? `${line.slice(0, 80)}...` : line;
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

async function getCloudConnectionStatus(
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

async function promptForApiBaseUrl(): Promise<string | undefined> {
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

async function promptForApiToken(): Promise<string | undefined> {
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

async function ensureCloudConfiguration(
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

async function buildCloudConfigErrorMessage(context: vscode.ExtensionContext): Promise<string> {
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

async function addRecentArtifact(
	context: vscode.ExtensionContext,
	artifact: RecentArtifact,
): Promise<void> {
	const current = context.globalState.get<RecentArtifact[]>('dataset.recentArtifacts') ?? [];
	const deduped = current.filter((entry) => entry.path !== artifact.path);
	const next = [artifact, ...deduped].slice(0, 5);
	await context.globalState.update('dataset.recentArtifacts', next);
}
