import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

type SidebarState = {
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

type ExtensionToWebview =
	| {
			type: 'state';
			payload: SidebarState;
	  };

type WebviewToExtension =
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

declare function acquireVsCodeApi(): {
	postMessage(message: WebviewToExtension): void;
};

const vscode = acquireVsCodeApi();

function App() {
	const [state, setState] = useState<SidebarState>({
		taskId: 'default',
		isSessionActive: false,
	});
	const [filter, setFilter] = useState('');
	const [packages, setPackages] = useState('');
	const [timeoutSec, setTimeoutSec] = useState('120');
	const [exportSince, setExportSince] = useState('');
	const [exportLimit, setExportLimit] = useState('');
	const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
	const [systemPrompt, setSystemPrompt] = useState('');
	const [userPrompt, setUserPrompt] = useState('Implement the requested change.');

	useEffect(() => {
		const listener = (event: MessageEvent) => {
			const message = event.data as ExtensionToWebview;
			if (message?.type === 'state') {
				setState(message.payload);
				if (!systemPrompt && message.payload.defaultSystemPrompt) {
					setSystemPrompt(message.payload.defaultSystemPrompt);
				}
			}
		};

		window.addEventListener('message', listener);
		vscode.postMessage({ type: 'ready' });

		return () => window.removeEventListener('message', listener);
	}, [systemPrompt]);

	const statusText = useMemo(
		() => (state.isSessionActive ? 'Active session' : 'No active session'),
		[state.isSessionActive],
	);

	const runPreset = (
		preset: 'install' | 'add' | 'addDev' | 'remove' | 'lint' | 'test' | 'build',
	) => {
		const timeoutValue = Number(timeoutSec);
		vscode.postMessage({
			type: 'runPnpmCommand',
			payload: {
				preset,
				filter: filter.trim() || undefined,
				packages: packages.trim() || undefined,
				timeoutMs: Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue * 1000 : undefined,
			},
		});
	};

	const runExport = () => {
		const since = exportSince.trim();
		const limitRaw = Number(exportLimit);
		vscode.postMessage({
			type: 'exportTaskJsonl',
			payload: {
				since: since.length > 0 ? since : undefined,
				limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : undefined,
			},
		});
	};

	const startSession = () => {
		vscode.postMessage({
			type: 'startSession',
			payload: {
				systemPrompt,
				userPrompt,
			},
		});
	};

	return (
		<main style={styles.container}>
			<div style={styles.headerRow}>
				<h2 style={styles.title}>Session Recorder</h2>
				<div style={styles.cloudMeta}>
					{state.cloudStatus ? (
						<span style={getCloudBadgeStyle(state.cloudStatus)}>{formatCloudStatus(state.cloudStatus)}</span>
					) : null}
					{state.lastCloudCheckAt ? (
						<span style={styles.cloudTimestamp}>
							Last check: {formatTimestamp(state.lastCloudCheckAt)}
						</span>
					) : null}
				</div>
			</div>
			<p style={styles.meta}>Task: {state.taskId || 'default'}</p>
			<p style={styles.meta}>Status: {statusText}</p>
			{state.lastSessionSummary ? (
				<p style={styles.meta}>
					Last Session: {state.lastSessionSummary.filesChanged} files,{' '}
					{state.lastSessionSummary.commandsRecorded} commands
				</p>
			) : null}
			{state.lastSessionStatus ? (
				<div style={styles.qualityRow}>
					<span style={styles.meta}>Last Session Quality:</span>
					<span style={getQualityBadgeStyle(state.lastSessionStatus)}>{state.lastSessionStatus}</span>
				</div>
			) : null}
			{state.lastRecordPath ? <p style={styles.path}>Last record: {state.lastRecordPath}</p> : null}

			<div style={styles.sectionCard}>
				<div style={styles.section}>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'selectTask' })}>
					Select Task
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'createTask' })}>
					Create Task
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'setupCloud' })}>
					Cloud Setup
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'setApiBaseUrl' })}>
					Set API Base URL
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'setApiToken' })}>
					Set API Token
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'checkCloudConnection' })}
					disabled={Boolean(state.isCloudChecking)}
				>
					{state.isCloudChecking ? 'Checking Cloud…' : 'Check Cloud Connection'}
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'syncLocalSessions' })}>
					Sync Local Sessions
				</button>
				</div>
			</div>

			<div style={styles.sectionCard}>
				<div style={styles.section}>
				<h3 style={styles.sectionTitle}>run_cmd</h3>
				<input
					style={styles.input}
					placeholder="--filter selector (optional)"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					disabled={!state.isSessionActive}
				/>
				<p style={styles.helperText}>Optional workspace selector used as `--filter &lt;value&gt;`.</p>
				<input
					style={styles.input}
					placeholder="packages for add/remove (space separated)"
					value={packages}
					onChange={(event) => setPackages(event.target.value)}
					disabled={!state.isSessionActive}
				/>
				<p style={styles.helperText}>Used only for `add`, `add -D`, and `remove` actions.</p>
				<input
					style={styles.input}
					placeholder="timeout seconds"
					value={timeoutSec}
					onChange={(event) => setTimeoutSec(event.target.value)}
					disabled={!state.isSessionActive}
				/>
				<p style={styles.helperText}>Command timeout in seconds (defaults to 120).</p>
				<div style={styles.buttonGrid}>
					<button style={styles.button} onClick={() => runPreset('install')} disabled={!state.isSessionActive}>
						pnpm i
					</button>
					<button style={styles.button} onClick={() => runPreset('add')} disabled={!state.isSessionActive}>
						pnpm add
					</button>
					<button style={styles.button} onClick={() => runPreset('addDev')} disabled={!state.isSessionActive}>
						pnpm add -D
					</button>
					<button style={styles.button} onClick={() => runPreset('remove')} disabled={!state.isSessionActive}>
						pnpm remove
					</button>
					<button style={styles.button} onClick={() => runPreset('lint')} disabled={!state.isSessionActive}>
						pnpm lint
					</button>
					<button style={styles.button} onClick={() => runPreset('test')} disabled={!state.isSessionActive}>
						pnpm test
					</button>
					<button style={styles.button} onClick={() => runPreset('build')} disabled={!state.isSessionActive}>
						pnpm build
					</button>
				</div>
				</div>
			</div>

			<div style={styles.sectionCard}>
				<div style={styles.section}>
				<h3 style={styles.sectionTitle}>export</h3>
				<input
					style={styles.input}
					placeholder="since (ISO datetime, optional)"
					value={exportSince}
					onChange={(event) => setExportSince(event.target.value)}
				/>
				<p style={styles.helperText}>Example: 2026-02-21T20:00:00.000Z</p>
				<input
					style={styles.input}
					placeholder="limit (optional)"
					value={exportLimit}
					onChange={(event) => setExportLimit(event.target.value)}
				/>
				<p style={styles.helperText}>Maximum number of sessions to export.</p>
				<button style={styles.button} onClick={runExport}>
					Export Task JSONL
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'importJsonlUpdates' })}>
					Validate + Import JSONL Updates
				</button>
				</div>
			</div>

			<div style={styles.sectionCard}>
				<div style={styles.section}>
				<h3 style={styles.sectionTitle}>recent</h3>
				{(state.recentArtifacts ?? []).length === 0 ? (
					<p style={styles.helperText}>No local artifacts yet.</p>
				) : (
					<div style={styles.recentList}>
						{(state.recentArtifacts ?? []).map((artifact) => (
							<div
								key={`${artifact.type}:${artifact.path}`}
								style={styles.recentItem}
							>
								<button
									style={styles.recentOpenButton}
									onClick={() =>
										vscode.postMessage({ type: 'openRecentArtifact', payload: { path: artifact.path } })
									}
								>
									<span style={styles.recentTitle}>
										{artifact.type === 'session' ? 'Session' : 'Export'}
										{artifact.status ? ` • ${artifact.status}` : ''}
									</span>
									<span style={styles.recentMeta}>{formatRelativeTime(artifact.createdAt)}</span>
								</button>
								<button
									style={styles.deleteButton}
									title="Delete artifact"
									onClick={() =>
										vscode.postMessage({ type: 'deleteRecentArtifact', payload: { path: artifact.path } })
									}
								>
									🗑
								</button>
							</div>
						))}
					</div>
				)}
				</div>
			</div>

			<div style={styles.sectionCard}>
				<div style={styles.section}>
				<button
					style={styles.button}
					onClick={() => setIsCreateSessionOpen((current) => !current)}
					disabled={state.isSessionActive}
				>
					{isCreateSessionOpen ? 'Hide Create Session' : 'Create Session'}
				</button>
				{isCreateSessionOpen ? (
					<>
						<textarea
							style={styles.textarea}
							placeholder="System prompt"
							value={systemPrompt}
							onChange={(event) => setSystemPrompt(event.target.value)}
							disabled={state.isSessionActive}
						/>
						<textarea
							style={styles.textarea}
							placeholder="User prompt"
							value={userPrompt}
							onChange={(event) => setUserPrompt(event.target.value)}
							disabled={state.isSessionActive}
						/>
						<button
							style={styles.button}
							onClick={startSession}
							disabled={state.isSessionActive || !systemPrompt.trim() || !userPrompt.trim()}
						>
							Start Session
						</button>
					</>
				) : null}
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'stopSessionUpload' })}
					disabled={!state.isSessionActive}
				>
					Stop Session
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'submitFileChanges' })}
					disabled={!state.isSessionActive}
				>
					Submit File Changes
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'discardSession' })}
					disabled={!state.isSessionActive}
				>
					Discard Session
				</button>
				</div>
			</div>
		</main>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		fontFamily: 'var(--vscode-font-family)',
		fontSize: 'var(--vscode-font-size)',
		color: 'var(--vscode-foreground)',
		padding: 12,
		display: 'flex',
		flexDirection: 'column',
		gap: 8,
	},
	headerRow: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'flex-start',
		gap: 8,
	},
	cloudMeta: {
		display: 'flex',
		flexDirection: 'column',
		alignItems: 'flex-end',
		gap: 3,
	},
	cloudTimestamp: {
		fontSize: '0.68rem',
		opacity: 0.7,
	},
	title: {
		fontSize: '1rem',
		margin: 0,
	},
	meta: {
		margin: 0,
		opacity: 0.9,
	},
	qualityRow: {
		display: 'flex',
		alignItems: 'center',
		gap: 6,
	},
	path: {
		margin: 0,
		wordBreak: 'break-all',
		opacity: 0.85,
		fontSize: '0.82rem',
	},
	sectionCard: {
		background: 'var(--vscode-editorWidget-background)',
		border: '1px solid var(--vscode-editorWidget-border)',
		borderRadius: 8,
		padding: 8,
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: 6,
	},
	buttonGrid: {
		display: 'grid',
		gridTemplateColumns: '1fr 1fr',
		gap: 6,
	},
	recentList: {
		display: 'flex',
		flexDirection: 'column',
		gap: 6,
	},
	recentItem: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		gap: 6,
		padding: '6px 8px',
		borderRadius: 6,
		border: '1px solid var(--vscode-input-border)',
		background: 'var(--vscode-editor-background)',
	},
	recentOpenButton: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		gap: 8,
		width: '100%',
		padding: 0,
		background: 'transparent',
		border: 'none',
		color: 'var(--vscode-foreground)',
		cursor: 'pointer',
		textAlign: 'left',
	},
	deleteButton: {
		padding: '2px 6px',
		borderRadius: 6,
		border: '1px solid var(--vscode-input-border)',
		background: 'var(--vscode-editorWidget-background)',
		color: 'var(--vscode-foreground)',
		cursor: 'pointer',
		lineHeight: 1,
	},
	recentTitle: {
		fontSize: '0.78rem',
		fontWeight: 500,
	},
	recentMeta: {
		fontSize: '0.72rem',
		opacity: 0.7,
	},
	sectionTitle: {
		fontSize: '0.85rem',
		fontWeight: 600,
		margin: '2px 0',
		opacity: 0.9,
	},
	input: {
		padding: '6px 8px',
		background: 'var(--vscode-input-background)',
		border: '1px solid var(--vscode-input-border)',
		borderRadius: 6,
		color: 'var(--vscode-input-foreground)',
	},
	textarea: {
		padding: '6px 8px',
		minHeight: 64,
		resize: 'vertical',
		background: 'var(--vscode-input-background)',
		border: '1px solid var(--vscode-input-border)',
		borderRadius: 6,
		color: 'var(--vscode-input-foreground)',
		fontFamily: 'var(--vscode-editor-font-family, var(--vscode-font-family))',
		fontSize: 'var(--vscode-font-size)',
	},
	helperText: {
		margin: '-2px 0 2px 0',
		fontSize: '0.75rem',
		opacity: 0.75,
		lineHeight: 1.3,
	},
	button: {
		padding: '6px 8px',
		background: 'var(--vscode-button-background)',
		border: '1px solid var(--vscode-input-border)',
		borderRadius: 6,
		color: 'var(--vscode-button-foreground)',
		cursor: 'pointer',
		textAlign: 'left',
		fontWeight: 500,
	},
};

function getQualityBadgeStyle(status: 'draft' | 'ready'): React.CSSProperties {
	if (status === 'ready') {
		return {
			padding: '1px 6px',
			borderRadius: 999,
			background: 'var(--vscode-badge-background)',
			color: 'var(--vscode-badge-foreground)',
			border: '1px solid var(--vscode-testing-iconPassed)',
			textTransform: 'uppercase',
			fontSize: '0.72rem',
			letterSpacing: '0.04em',
		};
	}

	return {
		padding: '1px 6px',
		borderRadius: 999,
		background: 'var(--vscode-badge-background)',
		color: 'var(--vscode-badge-foreground)',
		border: '1px solid var(--vscode-input-border)',
		textTransform: 'uppercase',
		fontSize: '0.72rem',
		letterSpacing: '0.04em',
	};
}

function getCloudBadgeStyle(
	status: 'connected' | 'url-missing' | 'token-missing' | 'unreachable',
): React.CSSProperties {
	if (status === 'connected') {
		return {
			padding: '1px 6px',
			borderRadius: 999,
			background: 'var(--vscode-badge-background)',
			color: 'var(--vscode-badge-foreground)',
			border: '1px solid var(--vscode-testing-iconPassed)',
			fontSize: '0.7rem',
		};
	}

	if (status === 'unreachable') {
		return {
			padding: '1px 6px',
			borderRadius: 999,
			background: 'var(--vscode-badge-background)',
			color: 'var(--vscode-badge-foreground)',
			border: '1px solid var(--vscode-testing-iconFailed)',
			fontSize: '0.7rem',
		};
	}

	return {
		padding: '1px 6px',
		borderRadius: 999,
		background: 'var(--vscode-badge-background)',
		color: 'var(--vscode-badge-foreground)',
		border: '1px solid var(--vscode-input-border)',
		fontSize: '0.7rem',
	};
}

function formatCloudStatus(
	status: 'connected' | 'url-missing' | 'token-missing' | 'unreachable',
): string {
	switch (status) {
		case 'connected':
			return 'Cloud: Connected';
		case 'url-missing':
			return 'Cloud: URL Missing';
		case 'token-missing':
			return 'Cloud: Token Missing';
		case 'unreachable':
			return 'Cloud: Unreachable';
	}
}

function formatTimestamp(iso: string): string {
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) {
		return 'unknown';
	}

	return parsed.toLocaleTimeString(undefined, {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	});
}

function formatRelativeTime(iso: string): string {
	const value = new Date(iso).getTime();
	if (Number.isNaN(value)) {
		return 'unknown';
	}

	const deltaSeconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
	if (deltaSeconds < 60) {
		return `${deltaSeconds}s ago`;
	}
	if (deltaSeconds < 3600) {
		return `${Math.floor(deltaSeconds / 60)}m ago`;
	}
	if (deltaSeconds < 86400) {
		return `${Math.floor(deltaSeconds / 3600)}h ago`;
	}
	return `${Math.floor(deltaSeconds / 86400)}d ago`;
}

const rootElement = document.getElementById('root');
if (rootElement) {
	createRoot(rootElement).render(<App />);
}