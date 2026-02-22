import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function main() {
	const cwd = process.cwd();
	const packagesDir = join(cwd, 'packages');
	const entries = await readdir(packagesDir, { withFileTypes: true });

	const vsixFiles = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith('.vsix')) {
			continue;
		}
		vsixFiles.push(join(packagesDir, entry.name));
	}

	if (vsixFiles.length === 0) {
		throw new Error(`No .vsix files found in ${packagesDir}. Run \"pnpm package\" first.`);
	}

	vsixFiles.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
	const latestVsix = vsixFiles[0];
	const codeBin = process.env.CODE_BIN?.trim() || 'code';

	console.log(`Installing latest VSIX: ${latestVsix}`);
	console.log(`Using VS Code binary: ${codeBin}`);

	await run(codeBin, ['--install-extension', latestVsix, '--force']);
	console.log('VSIX install complete.');
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			shell: false,
		});

		child.on('error', (error) => {
			reject(new Error(`Failed to run \"${command}\". Set CODE_BIN if needed. ${error.message}`));
		});

		child.on('exit', (code) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Command exited with code ${code}.`));
		});
	});
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
