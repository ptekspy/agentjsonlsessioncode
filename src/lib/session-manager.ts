import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import { addApplyPatch, makeSystem, makeToolCallMessage, makeToolResultMessage, makeUser } from './record-builders';
import type { ApplyPatchOperation, TrainingRecord } from './tooling';

const execFileAsync = promisify(execFile);

const IGNORE_PREFIXES = [
	'.agent-dataset/',
	'node_modules/',
	'.next/',
	'dist/',
	'build/',
	'out/',
];

type ActiveSession = {
	taskId: string;
	systemPrompt: string;
	userPrompt: string;
	baseRef: string;
	repoRoot: string;
	repoName: string;
	branch: string;
	remote?: string;
	commandsRun: string[];
	startedAt: string;
};

type NameStatusChange =
	| { kind: 'M'; path: string }
	| { kind: 'A'; path: string }
	| { kind: 'D'; path: string }
	| { kind: 'R'; oldPath: string; newPath: string };

export type BuiltSessionResult = {
	outputPath: string;
	payload: {
		taskId: string;
		repo: {
			name: string;
			root: string;
			branch: string;
			remote?: string;
		};
		baseRef: string;
		createdAt: string;
		startedAt: string;
		metrics: {
			filesChanged: number;
			commandsRun: string[];
		};
		record: TrainingRecord;
	};
};

export class SessionManager {
	private activeSession: ActiveSession | undefined;

	public hasActiveSession(): boolean {
		return this.activeSession !== undefined;
	}

	public async startSession(taskId: string, systemPrompt: string, userPrompt: string): Promise<void> {
		if (this.activeSession) {
			throw new Error('A session is already active. Stop or discard it first.');
		}

		const repoRoot = this.getSingleWorkspaceRoot();
		await this.ensureGitRepo(repoRoot);
		await this.ensureCleanWorkingTree(repoRoot);

		const baseRef = await this.gitLine(repoRoot, ['rev-parse', 'HEAD']);
		const branch = await this.gitLine(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']);
		const repoName = path.basename(repoRoot);

		let remote: string | undefined;
		try {
			remote = await this.gitLine(repoRoot, ['remote', 'get-url', 'origin']);
		} catch {
			remote = undefined;
		}

		this.activeSession = {
			taskId,
			systemPrompt,
			userPrompt,
			baseRef,
			repoRoot,
			repoName,
			branch,
			remote,
			commandsRun: [],
			startedAt: new Date().toISOString(),
		};
	}

	public discardSession(): void {
		this.activeSession = undefined;
	}

	public async stopAndBuildLocalRecord(context: ExtensionContext): Promise<BuiltSessionResult> {
		if (!this.activeSession) {
			throw new Error('No active session to stop.');
		}

		const session = this.activeSession;
		const changes = await this.getNameStatusChanges(session.repoRoot, session.baseRef);
		const filtered = changes.filter((change) => this.isIncludedChange(change));

		const record: TrainingRecord = {
			messages: [makeSystem(session.systemPrompt), makeUser(session.userPrompt)],
		};

		let callSeq = 0;
		const nextCallId = (prefix: string) => `${prefix}_${++callSeq}`;

		for (const change of filtered) {
			if (change.kind === 'M' || change.kind === 'D') {
				const callId = nextCallId('read');
				record.messages.push(makeToolCallMessage(callId, 'repo.readFile', { path: change.path }));
				const content = await this.safeGitShow(session.repoRoot, session.baseRef, change.path);
				record.messages.push(makeToolResultMessage(callId, content));
			}

			if (change.kind === 'R') {
				const callId = nextCallId('read');
				record.messages.push(makeToolCallMessage(callId, 'repo.readFile', { path: change.oldPath }));
				const content = await this.safeGitShow(session.repoRoot, session.baseRef, change.oldPath);
				record.messages.push(makeToolResultMessage(callId, content));
			}
		}

		const operations = await this.buildApplyPatchOperations(session.repoRoot, session.baseRef, filtered);
		if (operations.length > 0) {
			const applyPatchCallId = nextCallId('apply_patch');
			addApplyPatch(record, applyPatchCallId, {
				data: { action: { operations } },
			});
		}

		const payload = {
			taskId: session.taskId,
			repo: {
				name: session.repoName,
				root: session.repoRoot,
				branch: session.branch,
				remote: session.remote,
			},
			baseRef: session.baseRef,
			createdAt: new Date().toISOString(),
			startedAt: session.startedAt,
			metrics: {
				filesChanged: filtered.length,
				commandsRun: session.commandsRun,
			},
			record,
		};

		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			throw new Error('No workspace folder found while writing session record.');
		}

		const outputRoot = path.join(folder.uri.fsPath, '.agent-dataset', 'sessions');
		await fs.mkdir(outputRoot, { recursive: true });
		const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
		const outputPath = path.join(outputRoot, fileName);
		await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');

		this.activeSession = undefined;
		void context.globalState.update('dataset.lastRecordPath', outputPath);

		return {
			outputPath,
			payload,
		};
	}

	private async getNameStatusChanges(repoRoot: string, baseRef: string): Promise<NameStatusChange[]> {
		const output = await this.git(repoRoot, ['diff', '--name-status', baseRef]);
		if (!output) {
			return [];
		}

		const rows = output.split('\n').map((row) => row.trim()).filter(Boolean);
		const changes: NameStatusChange[] = [];

		for (const row of rows) {
			const parts = row.split('\t');
			const status = parts[0];
			if (status === 'M' && parts[1]) {
				changes.push({ kind: 'M', path: parts[1] });
				continue;
			}
			if (status === 'A' && parts[1]) {
				changes.push({ kind: 'A', path: parts[1] });
				continue;
			}
			if (status === 'D' && parts[1]) {
				changes.push({ kind: 'D', path: parts[1] });
				continue;
			}
			if (status.startsWith('R') && parts[1] && parts[2]) {
				changes.push({ kind: 'R', oldPath: parts[1], newPath: parts[2] });
			}
		}

		return changes;
	}

	private isIncludedChange(change: NameStatusChange): boolean {
		if (change.kind === 'R') {
			return this.isIncludedPath(change.oldPath) || this.isIncludedPath(change.newPath);
		}
		return this.isIncludedPath(change.path);
	}

	private isIncludedPath(filePath: string): boolean {
		return !IGNORE_PREFIXES.some((prefix) => filePath.startsWith(prefix));
	}

	private async buildApplyPatchOperations(
		repoRoot: string,
		baseRef: string,
		changes: NameStatusChange[],
	): Promise<ApplyPatchOperation[]> {
		const deletes: ApplyPatchOperation[] = [];
		const updates: ApplyPatchOperation[] = [];
		const creates: ApplyPatchOperation[] = [];

		for (const change of changes) {
			if (change.kind === 'D') {
				deletes.push({ type: 'delete_file', path: change.path });
				continue;
			}
			if (change.kind === 'M') {
				const fullDiff = await this.git(repoRoot, ['diff', baseRef, '--', change.path]);
				const hunkOnly = this.extractHunkBody(fullDiff);
				if (hunkOnly) {
					updates.push({ type: 'update_file', path: change.path, diff: hunkOnly });
				}
				continue;
			}
			if (change.kind === 'A') {
				const createContent = await this.readTextFile(path.join(repoRoot, change.path));
				creates.push({ type: 'create_file', path: change.path, diff: createContent });
				continue;
			}
			if (change.kind === 'R') {
				deletes.push({ type: 'delete_file', path: change.oldPath });
				const createContent = await this.readTextFile(path.join(repoRoot, change.newPath));
				creates.push({ type: 'create_file', path: change.newPath, diff: createContent });
			}
		}

		deletes.sort((a, b) => a.path.localeCompare(b.path));
		updates.sort((a, b) => a.path.localeCompare(b.path));
		creates.sort((a, b) => a.path.localeCompare(b.path));

		return [...deletes, ...updates, ...creates];
	}

	private extractHunkBody(fullDiff: string): string {
		const idx = fullDiff.indexOf('@@');
		if (idx < 0) {
			return '';
		}
		return fullDiff.slice(idx);
	}

	private async safeGitShow(repoRoot: string, baseRef: string, filePath: string): Promise<string> {
		try {
			const { stdout } = await execFileAsync('git', ['show', `${baseRef}:${filePath}`], {
				cwd: repoRoot,
				encoding: 'buffer',
				maxBuffer: 20 * 1024 * 1024,
			});
			const content = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
			if (this.isProbablyBinary(content)) {
				return '[binary file skipped]';
			}
			return content.toString('utf8');
		} catch {
			return '[unavailable at baseRef]';
		}
	}

	private async readTextFile(filePath: string): Promise<string> {
		const content = await fs.readFile(filePath);
		if (this.isProbablyBinary(content)) {
			throw new Error(`Binary file not supported for create_file: ${filePath}`);
		}
		return content.toString('utf8');
	}

	private isProbablyBinary(content: Buffer): boolean {
		for (const byte of content.subarray(0, Math.min(content.length, 8000))) {
			if (byte === 0) {
				return true;
			}
		}
		return false;
	}

	private async ensureGitRepo(repoRoot: string): Promise<void> {
		const inside = await this.gitLine(repoRoot, ['rev-parse', '--is-inside-work-tree']);
		if (inside !== 'true') {
			throw new Error('Workspace is not a git repository.');
		}
	}

	private async ensureCleanWorkingTree(repoRoot: string): Promise<void> {
		const status = await this.git(repoRoot, ['status', '--porcelain']);
		if (status.length > 0) {
			throw new Error('Repository is not clean. Commit or stash changes before starting a session.');
		}
	}

	private getSingleWorkspaceRoot(): string {
		const folders = vscode.workspace.workspaceFolders;
		if (!folders || folders.length !== 1) {
			throw new Error('Session Recorder v1 supports single-root workspaces only.');
		}
		return folders[0].uri.fsPath;
	}

	private async git(repoRoot: string, args: string[]): Promise<string> {
		const { stdout } = await execFileAsync('git', args, {
			cwd: repoRoot,
			encoding: 'utf8',
			maxBuffer: 20 * 1024 * 1024,
		});
		return stdout;
	}

	private async gitLine(repoRoot: string, args: string[]): Promise<string> {
		const line = await this.git(repoRoot, args);
		return line.replace(/\r?\n$/, '');
	}
}