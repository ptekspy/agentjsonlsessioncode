import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { type CloudTask } from './lib/cloud-api';
import { SessionManager } from './lib/session-manager';
import { DatasetSidebarProvider } from './sidebar/dataset-sidebar';
import type { CloudConnectionStatus } from './lib/extension/cloud-connection-status';
import type { RecentArtifact } from './lib/extension/recent-artifact';
import { toErrorMessage } from './lib/extension/to-error-message';
import { summarizeOutput } from './lib/extension/summarize-output';
import { buildRunCmdArgs } from './lib/extension/build-run-cmd-args';
import { buildUploadPayload } from './lib/extension/build-upload-payload';
import { getSingleWorkspaceFolder } from './lib/extension/get-single-workspace-folder';
import { resolveWorkspaceDirectoryPath } from './lib/extension/resolve-workspace-directory-path';
import { listFilesRecursively } from './lib/extension/list-files-recursively';
import { toWorkspaceRelativeDirectoryPath } from './lib/extension/to-workspace-relative-directory-path';
import { getCloudApiClient } from './lib/extension/get-cloud-api-client';
import { getCloudConnectionStatus } from './lib/extension/get-cloud-connection-status';
import { promptForApiBaseUrl } from './lib/extension/prompt-for-api-base-url';
import { promptForApiToken } from './lib/extension/prompt-for-api-token';
import { ensureCloudConfiguration } from './lib/extension/ensure-cloud-configuration';
import { buildCloudConfigErrorMessage } from './lib/extension/build-cloud-config-error-message';
import { addRecentArtifact } from './lib/extension/add-recent-artifact';

const DEFAULT_SYSTEM_PROMPT =
	'You are an expert TypeScript/Next.js coding assistant generating high-quality training traces. Be precise, minimal, and deterministic. Read before edit; search before multi-file changes. Keep patches focused, avoid unnecessary dependencies, and maintain current architecture. When ready to change files, call apply_patch. Do not paste code outside tool calls. Validate with lint/test/build when relevant. Surface errors clearly, avoid hidden side effects, and stop once the requested task is fully complete.';

export function activate(context: vscode.ExtensionContext) {
	const sessionManager = new SessionManager();
	let cachedTasks: CloudTask[] = [];
	let cloudStatus: CloudConnectionStatus = 'url-missing';
	let isCloudChecking = false;
	let lastCloudCheckAt: string | undefined;
	const getSidebarState = () => ({
		taskId: (context.workspaceState.get<string>('dataset.taskId') ?? '').trim(),
		isSessionActive: sessionManager.hasActiveSession(),
		defaultSystemPrompt:
			vscode.workspace
				.getConfiguration('dataset')
				.get<string>('defaultSystemPrompt', DEFAULT_SYSTEM_PROMPT)
				.trim() || DEFAULT_SYSTEM_PROMPT,
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
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (document.uri.scheme !== 'file') {
				return;
			}
			void sessionManager.recordOpenedFile(document.uri.fsPath);
		}),
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
		vscode.commands.registerCommand('dataset.syncLocalSessions', async () => {
			try {
				const api = await getCloudApiClient(context);
				if (!api) {
					await refreshCloudStatus();
					throw new Error('Set dataset.apiBaseUrl and Dataset API token before syncing sessions.');
				}

				const recentArtifacts =
					context.globalState.get<RecentArtifact[]>('dataset.recentArtifacts') ?? [];
				const pending = recentArtifacts.filter(
					(artifact) => artifact.type === 'session' && !artifact.cloudSessionId,
				);

				if (pending.length === 0) {
					vscode.window.showInformationMessage('No unsynced local sessions found in Recent artifacts.');
					return;
				}

				const failures: string[] = [];
				const byPath = new Map(recentArtifacts.map((artifact) => [artifact.path, artifact]));

				for (const artifact of pending) {
					try {
						const raw = await fs.readFile(artifact.path, 'utf8');
						const payload = JSON.parse(raw) as unknown;
						const upload = await api.createSession(payload);
						const existing = byPath.get(artifact.path);
						if (existing) {
							existing.cloudSessionId = upload.sessionId;
						}
					} catch {
						failures.push(path.basename(artifact.path));
					}
				}

				const updated = Array.from(byPath.values());
				await context.globalState.update('dataset.recentArtifacts', updated);
				cloudStatus = 'connected';
				lastCloudCheckAt = new Date().toISOString();
				refreshSidebar();

				const syncedCount = pending.length - failures.length;
				if (failures.length === 0) {
					vscode.window.showInformationMessage(`Synced ${syncedCount} local session(s) to cloud.`);
				} else {
					vscode.window.showWarningMessage(
						`Synced ${syncedCount} session(s); failed ${failures.length}: ${failures.join(', ')}`,
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.importJsonlUpdates', async () => {
			try {
				const api = await getCloudApiClient(context);
				if (!api) {
					await refreshCloudStatus();
					throw new Error('Set dataset.apiBaseUrl and Dataset API token before importing updates.');
				}

				const selection = await vscode.window.showOpenDialog({
					canSelectMany: false,
					openLabel: 'Import JSONL updates',
					filters: {
						JSONL: ['jsonl', 'ndjson'],
						JSON: ['json'],
					},
				});

				if (!selection || selection.length === 0) {
					return;
				}

				const content = await fs.readFile(selection[0].fsPath, 'utf8');
				const lines = content
					.split(/\r?\n/)
					.map((line) => line.trim())
					.filter(Boolean);

				const candidates: Array<{ sessionId: string; messages: unknown[] }> = [];
				let invalidFormatCount = 0;

				for (const line of lines) {
					try {
						const parsed = JSON.parse(line) as {
							sessionId?: unknown;
							messages?: unknown;
							record?: { messages?: unknown };
						};

						const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '';
						const messagesCandidate = Array.isArray(parsed.messages)
							? parsed.messages
							: Array.isArray(parsed.record?.messages)
								? parsed.record.messages
								: undefined;

						if (!sessionId || !messagesCandidate) {
							invalidFormatCount += 1;
							continue;
						}

						candidates.push({ sessionId, messages: messagesCandidate });
					} catch {
						invalidFormatCount += 1;
					}
				}

				const latestBySession = new Map<string, { sessionId: string; messages: unknown[] }>();
				for (const candidate of candidates) {
					latestBySession.set(candidate.sessionId, candidate);
				}

				const duplicateCount = candidates.length - latestBySession.size;
				const dryRunReady: Array<{ sessionId: string; messages: unknown[] }> = [];
				let missingSessionCount = 0;

				for (const candidate of latestBySession.values()) {
					const exists = await api.sessionExists(candidate.sessionId);
					if (!exists) {
						missingSessionCount += 1;
						continue;
					}

					dryRunReady.push(candidate);
				}

				const summary = [
					`Dry run complete for ${lines.length} JSONL line(s).`,
					`${dryRunReady.length} updatable session(s).`,
					`${invalidFormatCount} invalid line(s).`,
					`${missingSessionCount} missing session id(s).`,
					`${duplicateCount} duplicate session id line(s) (last line kept).`,
				].join(' ');

				if (dryRunReady.length === 0) {
					vscode.window.showWarningMessage(`${summary} No updates were applied.`);
					return;
				}

				const decision = await vscode.window.showInformationMessage(
					summary,
					{ modal: true },
					'Apply Updates',
				);

				if (decision !== 'Apply Updates') {
					vscode.window.showInformationMessage('JSONL import canceled after dry run.');
					return;
				}

				let updated = 0;
				let failed = 0;

				for (const candidate of dryRunReady) {
					try {
						await api.updateSessionRecord(candidate.sessionId, { messages: candidate.messages });
						updated += 1;
					} catch {
						failed += 1;
					}
				}

				if (failed === 0) {
					vscode.window.showInformationMessage(`Imported JSONL updates: ${updated} session(s) updated.`);
				} else {
					vscode.window.showWarningMessage(
						`Imported JSONL updates: ${updated} updated, ${failed} failed during apply.`,
					);
				}
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
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
		vscode.commands.registerCommand('dataset.deleteRecentArtifact', async (artifactPath: string) => {
			try {
				if (!artifactPath || typeof artifactPath !== 'string') {
					return;
				}

				const recentArtifacts =
					context.globalState.get<RecentArtifact[]>('dataset.recentArtifacts') ?? [];
				const artifact = recentArtifacts.find((entry) => entry.path === artifactPath);
				const artifactLabel = artifact?.type === 'export' ? 'export' : 'session';

				const confirmed = await vscode.window.showWarningMessage(
					`Delete this recent ${artifactLabel} artifact from disk?`,
					{ modal: true },
					'Delete',
				);

				if (confirmed !== 'Delete') {
					return;
				}

				if (artifact?.cloudSessionId) {
					const api = await getCloudApiClient(context);
					if (!api) {
						throw new Error(
							'This session is cloud-backed. Configure dataset.apiBaseUrl and API token to delete from DB.',
						);
					}
					await api.deleteSession(artifact.cloudSessionId);
				}

				await fs.rm(artifactPath, { force: true });
				const nextArtifacts = recentArtifacts.filter((entry) => entry.path !== artifactPath);
				await context.globalState.update('dataset.recentArtifacts', nextArtifacts);
				refreshSidebar();
				vscode.window.showInformationMessage('Recent artifact deleted.');
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dataset.startSession',
			async (input?: { systemPrompt?: string; userPrompt?: string }) => {
			try {
				const taskId = (context.workspaceState.get<string>('dataset.taskId') ?? '').trim();
				if (!taskId) {
					vscode.window.showErrorMessage('Select or create a task before starting a session.');
					return;
				}
				const configuredSystemPrompt = vscode.workspace
					.getConfiguration('dataset')
					.get<string>('defaultSystemPrompt', DEFAULT_SYSTEM_PROMPT)
					.trim();
				const systemPrompt = (input?.systemPrompt ?? configuredSystemPrompt).trim();

				if (!systemPrompt) {
					vscode.window.showErrorMessage('System prompt is required to start a session.');
					return;
				}
				const userPrompt = (input?.userPrompt ?? 'Implement the requested change.').trim();

				if (!userPrompt) {
					vscode.window.showErrorMessage('User prompt is required to start a session.');
					return;
				}

				await sessionManager.startSession(taskId, systemPrompt, userPrompt);
				vscode.window.showInformationMessage('Dataset session started.');
				refreshSidebar();
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
			},
		),
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
		vscode.commands.registerCommand(
			'dataset.searchRepo',
			async (input?: { query?: string; path?: string; maxResults?: number }) => {
			try {
				const provided = (input?.query ?? '').trim();
				const searchPath = (input?.path ?? '').trim() || undefined;
				const maxResults =
					typeof input?.maxResults === 'number' && Number.isFinite(input.maxResults) && input.maxResults > 0
						? Math.floor(input.maxResults)
						: 20;
				const query =
					provided ||
					(
						await vscode.window.showInputBox({
							prompt: 'Search query for repo.search (grep pattern)',
							placeHolder: 'useState|TODO|functionName',
							ignoreFocusOut: true,
						})
					)?.trim() ||
					'';

				if (!query) {
					return;
				}

				const results = await sessionManager.searchRepo(query, {
					path: searchPath,
					maxResults,
				});
				if (results.length === 0) {
					vscode.window.showInformationMessage('No files matched the search query.');
					refreshSidebar();
					return;
				}

				const uniqueFiles = Array.from(new Set(results.map((result) => result.path)));

				const selected = await vscode.window.showQuickPick(uniqueFiles, {
					placeHolder: `Search matched ${results.length} result(s) across ${uniqueFiles.length} file(s). Open one to record repo.readFile.`,
				});

				if (selected) {
					const folder = vscode.workspace.workspaceFolders?.[0];
					if (folder) {
						const fileUri = vscode.Uri.joinPath(folder.uri, selected);
						await vscode.commands.executeCommand('vscode.open', fileUri);
					}
				}

				vscode.window.showInformationMessage(
					`Recorded repo.search with ${results.length} result(s) across ${uniqueFiles.length} file(s).`,
				);
				refreshSidebar();
			} catch (error) {
				vscode.window.showErrorMessage(toErrorMessage(error));
			}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'dataset.listAndOpenDirectoryFiles',
			async (input?: { path?: string }) => {
				try {
					const folder = getSingleWorkspaceFolder();
					const providedPath = (input?.path ?? '').trim();
					const enteredPath =
						providedPath ||
						(
							await vscode.window.showInputBox({
								prompt: 'Directory path to list and open all files (workspace-relative)',
								placeHolder: 'src or src/components',
								ignoreFocusOut: true,
							})
						)?.trim() ||
						'';

					if (!enteredPath) {
						return;
					}

					const directoryPath = resolveWorkspaceDirectoryPath(folder.uri.fsPath, enteredPath);
					const stat = await fs.stat(directoryPath).catch(() => undefined);
					if (!stat || !stat.isDirectory()) {
						throw new Error('Directory not found inside workspace.');
					}

					const files = await listFilesRecursively(directoryPath, folder.uri.fsPath);
					if (files.length === 0) {
						vscode.window.showInformationMessage('No files found in the selected directory.');
						return;
					}

					await sessionManager.recordListTreeAndReadFiles(
						toWorkspaceRelativeDirectoryPath(folder.uri.fsPath, directoryPath),
						files,
					);

					for (const file of files) {
						const fileUri = vscode.Uri.joinPath(folder.uri, file);
						await vscode.commands.executeCommand('vscode.open', fileUri);
					}

					vscode.window.showInformationMessage(
						`Recorded repo.listTree + repo.readFile for ${files.length} file(s), and opened all files from ${enteredPath}.`,
					);
					refreshSidebar();
				} catch (error) {
					vscode.window.showErrorMessage(toErrorMessage(error));
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('dataset.submitFileChanges', async () => {
			try {
				const snapshot = await sessionManager.submitFileChangesCheckpoint();
				vscode.window.showInformationMessage(
					`Submitted file changes (${snapshot.filesChanged} files, ${snapshot.operationsApplied} patch operations). You can continue with pnpm commands.`,
				);
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
					await addRecentArtifact(context, {
						type: 'session',
						path: result.outputPath,
						createdAt: new Date().toISOString(),
						status: result.payload.status,
						cloudSessionId: upload.sessionId,
					});
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
				const taskId = (context.workspaceState.get<string>('dataset.taskId') ?? '').trim();
				if (!taskId) {
					throw new Error('Select or create a task before exporting JSONL.');
				}
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
				const exportDir = path.join(context.globalStorageUri.fsPath, 'exports');
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

export function deactivate() {}
