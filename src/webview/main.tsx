import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

type SidebarState = {
	taskId: string;
	isSessionActive: boolean;
	lastRecordPath?: string;
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
	| { type: 'setApiToken' }
	| { type: 'startSession' }
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
	| { type: 'exportTaskJsonl' }
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

	useEffect(() => {
		const listener = (event: MessageEvent) => {
			const message = event.data as ExtensionToWebview;
			if (message?.type === 'state') {
				setState(message.payload);
			}
		};

		window.addEventListener('message', listener);
		vscode.postMessage({ type: 'ready' });

		return () => window.removeEventListener('message', listener);
	}, []);

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

	return (
		<main style={styles.container}>
			<h2 style={styles.title}>Session Recorder</h2>
			<p style={styles.meta}>Task: {state.taskId || 'default'}</p>
			<p style={styles.meta}>Status: {statusText}</p>
			{state.lastRecordPath ? <p style={styles.path}>Last record: {state.lastRecordPath}</p> : null}

			<div style={styles.section}>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'selectTask' })}>
					Select Task
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'createTask' })}>
					Create Task
				</button>
				<button style={styles.button} onClick={() => vscode.postMessage({ type: 'setApiToken' })}>
					Set API Token
				</button>
			</div>

			<div style={styles.section}>
				<h3 style={styles.sectionTitle}>run_cmd</h3>
				<input
					style={styles.input}
					placeholder="--filter selector (optional)"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					disabled={!state.isSessionActive}
				/>
				<input
					style={styles.input}
					placeholder="packages for add/remove (space separated)"
					value={packages}
					onChange={(event) => setPackages(event.target.value)}
					disabled={!state.isSessionActive}
				/>
				<input
					style={styles.input}
					placeholder="timeout seconds"
					value={timeoutSec}
					onChange={(event) => setTimeoutSec(event.target.value)}
					disabled={!state.isSessionActive}
				/>
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

			<div style={styles.section}>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'startSession' })}
					disabled={state.isSessionActive}
				>
					Start Session
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'stopSessionUpload' })}
					disabled={!state.isSessionActive}
				>
					Stop Session
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'exportTaskJsonl' })}
				>
					Export Task JSONL
				</button>
				<button
					style={styles.button}
					onClick={() => vscode.postMessage({ type: 'discardSession' })}
					disabled={!state.isSessionActive}
				>
					Discard Session
				</button>
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
	title: {
		fontSize: '1rem',
		margin: 0,
	},
	meta: {
		margin: 0,
		opacity: 0.9,
	},
	path: {
		margin: 0,
		wordBreak: 'break-all',
		opacity: 0.85,
	},
	section: {
		display: 'flex',
		flexDirection: 'column',
		gap: 6,
		marginTop: 6,
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
		color: 'var(--vscode-input-foreground)',
	},
	button: {
		padding: '6px 8px',
		background: 'var(--vscode-button-background)',
		border: 'none',
		color: 'var(--vscode-button-foreground)',
		cursor: 'pointer',
		textAlign: 'left',
	},
};

const rootElement = document.getElementById('root');
if (rootElement) {
	createRoot(rootElement).render(<App />);
}