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