import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExtensionContext } from 'vscode';
import * as vscode from 'vscode';
import {
	addApplyPatch,
	addRunCmd,
	makeSystem,
	makeToolCallMessage,
	makeToolResultMessage,
	makeUser,
} from './record-builders';
import {
	normalizeRunCmdArgs,
	parseAllowedRunCmd,
	type ApplyPatchOperation,
	type RunCmdArgs,
	type TrainingRecord,
} from './tooling';

const execFileAsync = promisify(execFile);

const DEFAULT_IGNORE_GLOBS = [
	'.agent-dataset/**',
	'node_modules/**',
	'.next/**',
	'dist/**',
	'build/**',
	'out/**',
];

const DEFAULT_REDACTION_PATTERNS = [
	'(?:ghp|github_pat)_[A-Za-z0-9_]{20,}',
	'(?:sk|pk)_[A-Za-z0-9]{16,}',
	'[A-Za-z0-9_\\-]{24,}\\.[A-Za-z0-9_\\-]{20,}\\.[A-Za-z0-9_\\-]{20,}',
	"(api[-_ ]?key|token|secret)\\s*[:=]\\s*[^\\s\"']+",
];

const DEFAULT_MAX_COMMAND_OUTPUT_CHARS = 50_000;

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
	runCmdEvents: RunCmdEvent[];
	record: TrainingRecord;
	callSeq: number;
	fileChangesSubmitted: boolean;
	submittedFilesChanged: number;
	startedAt: string;
	openedFiles: Set<string>;
};

type RunCmdEvent = {
	args: RunCmdArgs;
	output: string;
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
		status: 'draft' | 'ready';
		record: TrainingRecord;
	};
};

export class SessionManager {
	private activeSession: ActiveSession | undefined;
	private runCmdTerminal: RunCmdTerminal | undefined;

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
			runCmdEvents: [],
			record: {
				messages: [makeSystem(systemPrompt), makeUser(userPrompt)],
			},
			callSeq: 0,
			fileChangesSubmitted: false,
			submittedFilesChanged: 0,
			startedAt: new Date().toISOString(),
			openedFiles: new Set<string>(),
		};
	}

	public discardSession(): void {
		this.activeSession = undefined;
	}

	public recordOpenedFile(filePath: string): void {
		if (!this.activeSession || !filePath) {
			return;
		}

		const normalizedFilePath = path.resolve(filePath);
		const repoRoot = this.activeSession.repoRoot;
		const normalizedRoot = path.resolve(repoRoot);
		const withSep = `${normalizedRoot}${path.sep}`;

		if (!normalizedFilePath.startsWith(withSep) && normalizedFilePath !== normalizedRoot) {
			return;
		}

		const relativePath = path.relative(repoRoot, normalizedFilePath).replace(/\\/g, '/');
		if (!relativePath || relativePath.startsWith('..')) {
			return;
		}

		if (!this.isIncludedPath(relativePath)) {
			return;
		}

		this.activeSession.openedFiles.add(relativePath);
	}

	public async runAllowedPnpmCommand(input: RunCmdArgs): Promise<string> {
		if (!this.activeSession) {
			throw new Error('Start a session before running recorded commands.');
		}

		const normalized = normalizeRunCmdArgs(input);
		parseAllowedRunCmd(normalized);

		const cwd = normalized.cwd ?? this.activeSession.repoRoot;
		const recordedArgs: RunCmdArgs = {
			...normalized,
			cwd,
		};
		const timeoutMs = normalized.timeoutMs ?? 120_000;

		const { output: rawOutput, failed } = await this.runPnpmWithLiveTerminal(recordedArgs, cwd, timeoutMs);
		const output = this.truncateOutput(this.redactOutput(rawOutput));

		this.activeSession.runCmdEvents.push({ args: recordedArgs, output });
		this.activeSession.commandsRun.push(`pnpm ${normalized.args.join(' ')}`);
		addRunCmd(this.activeSession.record, this.nextCallId(this.activeSession, 'run_cmd'), recordedArgs, output);

		if (failed) {
			throw new Error(output || 'run_cmd failed');
		}

		return output;
	}

	private async runPnpmWithLiveTerminal(
		args: RunCmdArgs,
		cwd: string,
		timeoutMs: number,
	): Promise<{ output: string; failed: boolean }> {
		const terminal = this.getOrCreateRunCmdTerminal();
		return terminal.runCommand(args, cwd, timeoutMs);
	}

	private getOrCreateRunCmdTerminal(): RunCmdTerminal {
		if (!this.runCmdTerminal || this.runCmdTerminal.isDisposed()) {
			this.runCmdTerminal = new RunCmdTerminal('Dataset run_cmd');
		}
		return this.runCmdTerminal;
	}

	public async submitFileChangesCheckpoint(): Promise<{ filesChanged: number; operationsApplied: number }> {
		if (!this.activeSession) {
			throw new Error('Start a session before submitting file changes.');
		}

		if (this.activeSession.fileChangesSubmitted) {
			throw new Error('File changes already submitted for this session.');
		}

		const snapshot = await this.appendFileChangesToRecord(this.activeSession);
		if (snapshot.operationsApplied === 0) {
			throw new Error('No file changes found to submit.');
		}

		this.activeSession.fileChangesSubmitted = true;
		this.activeSession.submittedFilesChanged = snapshot.filesChanged;

		return {
			filesChanged: snapshot.filesChanged,
			operationsApplied: snapshot.operationsApplied,
		};
	}

	public async stopAndBuildLocalRecord(context: ExtensionContext): Promise<BuiltSessionResult> {
		if (!this.activeSession) {
			throw new Error('No active session to stop.');
		}

		const session = this.activeSession;
		let filesChanged = session.submittedFilesChanged;
		let hasApplyPatch = this.recordHasApplyPatch(session.record);

		if (!session.fileChangesSubmitted) {
			const snapshot = await this.appendFileChangesToRecord(session);
			filesChanged = snapshot.filesChanged;
			hasApplyPatch = snapshot.operationsApplied > 0;
		}

		const ranValidationCommand = session.commandsRun.some((command) =>
			/(^|\s)(lint|test|build)(\s|$)/.test(command),
		);
		const status: 'draft' | 'ready' = hasApplyPatch && ranValidationCommand ? 'ready' : 'draft';

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
				filesChanged,
				commandsRun: session.commandsRun,
			},
			status,
			record: {
				messages: [...session.record.messages, { role: 'assistant' as const, content: 'Done.' }],
			},
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

	private nextCallId(session: ActiveSession, prefix: string): string {
		session.callSeq += 1;
		return `${prefix}_${session.callSeq}`;
	}

	private recordHasApplyPatch(record: TrainingRecord): boolean {
		return record.messages.some((message) => {
			if (message.role !== 'assistant' || !('tool_calls' in message)) {
				return false;
			}
			return message.tool_calls.some((call) => call.function.name === 'apply_patch');
		});
	}

	private async appendFileChangesToRecord(
		session: ActiveSession,
	): Promise<{ filesChanged: number; operationsApplied: number }> {
		const changes = await this.getNameStatusChanges(session.repoRoot, session.baseRef);
		const filtered = changes.filter((change) => this.isIncludedChange(change));
		const grepFoundPaths = this.collectSearchablePaths(filtered);
		const openedMatches = grepFoundPaths.filter((filePath) => session.openedFiles.has(filePath));

		if (openedMatches.length > 0) {
			const searchCallId = this.nextCallId(session, 'search');
			session.record.messages.push(
				makeToolCallMessage(searchCallId, 'repo.search', {
					query: `grep -R --line-number --files-with-matches "." ${grepFoundPaths.join(' ')}`,
				}),
			);
			session.record.messages.push(makeToolResultMessage(searchCallId, this.formatSearchResults(grepFoundPaths)));
		}

		for (const filePath of openedMatches) {
			const callId = this.nextCallId(session, 'read');
			session.record.messages.push(makeToolCallMessage(callId, 'repo.readFile', { path: filePath }));
			const content = await this.safeGitShow(session.repoRoot, session.baseRef, filePath);
			session.record.messages.push(makeToolResultMessage(callId, content));
		}

		const operations = await this.buildApplyPatchOperations(session.repoRoot, session.baseRef, filtered);
		if (operations.length > 0) {
			const applyPatchCallId = this.nextCallId(session, 'apply_patch');
			addApplyPatch(session.record, applyPatchCallId, {
				data: { action: { operations } },
			});
		}

		return {
			filesChanged: filtered.length,
			operationsApplied: operations.length,
		};
	}

	private collectSearchablePaths(changes: NameStatusChange[]): string[] {
		const unique = new Set<string>();
		for (const change of changes) {
			switch (change.kind) {
				case 'M':
				case 'A':
					unique.add(change.path);
					break;
				case 'D':
					break;
				case 'R':
					unique.add(change.oldPath);
					unique.add(change.newPath);
					break;
			}
		}

		return Array.from(unique).sort((left, right) => left.localeCompare(right));
	}

	private formatSearchResults(filePaths: string[]): string {
		return filePaths.join('\n');
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
		const normalizedPath = filePath.replace(/\\/g, '/');
		const patterns = this.getIgnoreGlobs();
		return !patterns.some((pattern) => globMatch(normalizedPath, pattern));
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
				const fullDiff = await this.git(repoRoot, ['diff', '-U999999', baseRef, '--', change.path]);
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

	private combineCommandOutput(stdout: string, stderr: string): string {
		const output = [stdout, stderr].filter((value) => value.length > 0).join('\n');
		return output.length > 0 ? output : '[no output]';
	}

	private parseCommandError(error: unknown): string {
		if (error && typeof error === 'object') {
			const candidate = error as {
				stdout?: string;
				stderr?: string;
				code?: string | number;
				signal?: string;
				message?: string;
			};

			const combined = this.combineCommandOutput(candidate.stdout ?? '', candidate.stderr ?? '');
			if (combined !== '[no output]') {
				return combined;
			}

			const code = candidate.code !== undefined ? `code=${String(candidate.code)}` : '';
			const signal = candidate.signal ? `signal=${candidate.signal}` : '';
			const suffix = [code, signal].filter(Boolean).join(' ');
			if (candidate.message) {
				return suffix ? `${candidate.message} (${suffix})` : candidate.message;
			}
		}

		if (error instanceof Error) {
			return error.message;
		}

		return 'run_cmd failed';
	}

	private truncateOutput(output: string): string {
		const maxChars = this.getMaxCommandOutputChars();
		if (output.length <= maxChars) {
			return output;
		}

		return `${output.slice(0, maxChars)}\n(truncated)`;
	}

	private getIgnoreGlobs(): string[] {
		const configured = vscode.workspace
			.getConfiguration('dataset')
			.get<string[]>('ignoreGlobs', DEFAULT_IGNORE_GLOBS);
		const values = configured.map((entry) => entry.trim()).filter(Boolean);
		return values.length > 0 ? values : DEFAULT_IGNORE_GLOBS;
	}

	private getMaxCommandOutputChars(): number {
		const configured = vscode.workspace
			.getConfiguration('dataset')
			.get<number>('maxCommandOutputChars', DEFAULT_MAX_COMMAND_OUTPUT_CHARS);
		if (!Number.isFinite(configured)) {
			return DEFAULT_MAX_COMMAND_OUTPUT_CHARS;
		}
		return Math.max(1024, Math.floor(configured));
	}

	private redactOutput(output: string): string {
		let redacted = output;
		for (const regex of this.getRedactionRegexes()) {
			redacted = redacted.replace(regex, '[REDACTED]');
		}
		return redacted;
	}

	private getRedactionRegexes(): RegExp[] {
		const configured = vscode.workspace
			.getConfiguration('dataset')
			.get<string[]>('redactionPatterns', DEFAULT_REDACTION_PATTERNS);

		const patterns = configured.length > 0 ? configured : DEFAULT_REDACTION_PATTERNS;
		const regexes: RegExp[] = [];

		for (const pattern of patterns) {
			try {
				regexes.push(new RegExp(pattern, 'g'));
			} catch {
				continue;
			}
		}

		return regexes;
	}
}

class RunCmdTerminal implements vscode.Pseudoterminal {
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	private readonly closeEmitter = new vscode.EventEmitter<number>();
	private readonly terminal: vscode.Terminal;
	private running = false;
	private disposed = false;
	private activeChild: ReturnType<typeof spawn> | undefined;

	public readonly onDidWrite = this.writeEmitter.event;
	public readonly onDidClose = this.closeEmitter.event;

	public constructor(name: string) {
		this.terminal = vscode.window.createTerminal({ name, pty: this });
	}

	public open(): void {}

	public close(): void {
		this.disposed = true;
		if (this.activeChild && !this.activeChild.killed) {
			this.activeChild.kill('SIGTERM');
		}
		this.writeEmitter.dispose();
		this.closeEmitter.dispose();
	}

	public isDisposed(): boolean {
		return this.disposed;
	}

	public async runCommand(
		args: RunCmdArgs,
		cwd: string,
		timeoutMs: number,
	): Promise<{ output: string; failed: boolean }> {
		if (this.disposed) {
			throw new Error('run_cmd terminal was closed. Run the command again to reopen it.');
		}

		if (this.running) {
			throw new Error('A run_cmd command is already running. Wait for it to finish first.');
		}

		this.running = true;
		this.terminal.show(true);

		return await new Promise((resolve) => {
			let collected = '';
			let settled = false;
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;

			const normalizedNewlines = (value: string) => value.replace(/\r?\n/g, '\r\n');
			const pushOutput = (value: string) => {
				collected += value;
				this.writeEmitter.fire(normalizedNewlines(value));
			};

			const settle = (failed: boolean, fallbackMessage?: string) => {
				if (settled) {
					return;
				}
				settled = true;
				if (timeoutHandle) {
					clearTimeout(timeoutHandle);
				}
				this.running = false;
				this.activeChild = undefined;

				const output = collected.length > 0 ? collected : (fallbackMessage ?? '[no output]');
				resolve({ output, failed });
			};

			pushOutput(`$ pnpm ${args.args.join(' ')}\n`);

			const child = spawn('pnpm', args.args, {
				cwd,
				env: args.env ? { ...process.env, ...args.env } : process.env,
				shell: false,
			});
			this.activeChild = child;

			child.stdout.on('data', (chunk: Buffer | string) => {
				pushOutput(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
			});

			child.stderr.on('data', (chunk: Buffer | string) => {
				pushOutput(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
			});

			child.on('error', (error) => {
				pushOutput(`${error.message}\n`);
				settle(true, error.message);
			});

			child.on('close', (code, signal) => {
				if (timedOut) {
					settle(true, 'run_cmd timed out');
					return;
				}

				if (signal) {
					settle(true, `run_cmd terminated by signal ${signal}`);
					return;
				}

				settle((code ?? 0) !== 0, `[exit code ${code ?? 0}]`);
			});

			timeoutHandle = setTimeout(() => {
				timedOut = true;
				pushOutput(`\nrun_cmd timed out after ${timeoutMs}ms\n`);
				child.kill('SIGTERM');
			}, timeoutMs);
		});
	}
}

function globMatch(targetPath: string, globPattern: string): boolean {
	try {
		const regex = new RegExp(`^${globToRegex(globPattern)}$`);
		return regex.test(targetPath);
	} catch {
		return false;
	}
}

function globToRegex(globPattern: string): string {
	let pattern = globPattern.replace(/\\/g, '/');
	if (!pattern.includes('*')) {
		pattern = `${pattern.replace(/\/+$/, '')}/**`;
	}

	let result = '';
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === '*') {
			const next = pattern[index + 1];
			if (next === '*') {
				result += '.*';
				index += 1;
			} else {
				result += '[^/]*';
			}
			continue;
		}

		if ('\\^$+?.()|{}[]'.includes(char)) {
			result += `\\${char}`;
		} else {
			result += char;
		}
	}

	return result;
}
