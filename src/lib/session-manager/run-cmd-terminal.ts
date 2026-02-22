import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import type { RunCmdArgs } from '../tooling';

export class RunCmdTerminal implements vscode.Pseudoterminal {
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
