import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolExecutionError, ToolPermissionError } from '@tools/errors';
import { ToolRegistry } from '@tools/registry';
import { registerShellTools } from '@tools/shell';
import type { ToolContext } from '@tools/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function ctx(cwd: string): ToolContext {
	return {
		cwd,
		policy: { allowPermissions: ['shell'] },
	};
}

let tmp: string;
let reg: ToolRegistry;
let c: ToolContext;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-shell-'));
	reg = new ToolRegistry();
	registerShellTools(reg);
	c = ctx(tmp);
});

afterEach(() => {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe('shell.exec', () => {
	it('runs a simple node command and captures stdout/stderr', async () => {
		// Write a small script to exercise stdout/stderr
		const f = path.join(tmp, 'prog.js');
		fs.writeFileSync(
			f,
			'process.stdout.write("OUT"); process.stderr.write("ERR");',
			'utf8'
		);

		const res = await reg.run<{
			ok: boolean;
			stdout: string;
			stderr: string;
			exitCode: number;
		}>(
			'shell.exec',
			{
				command: process.execPath,
				args: [f],
				cwd: '.',
				timeoutMs: 5000,
			},
			c
		);

		expect(res.ok).toBe(true);
		expect(res.exitCode).toBe(0);
		expect(res.stdout).toBe('OUT');
		expect(res.stderr).toBe('ERR');
	});

	it('throws ToolExecutionError on non-zero exit in non-interactive mode', async () => {
		const f = path.join(tmp, 'exit2.js');
		fs.writeFileSync(f, 'process.exit(2)', 'utf8');

		await expect(
			reg.run(
				'shell.exec',
				{
					command: process.execPath,
					args: [f],
					timeoutMs: 5000,
				},
				c
			)
		).rejects.toBeInstanceOf(ToolExecutionError);
	});

	it('returns preview + confirmToken for destructive commands', async () => {
		// We won't actually run rm; just check the gate
		const preview = await reg.run<{
			preview: boolean;
			requiresConfirmation: boolean;
			confirmToken: string;
			reasons: string[];
		}>(
			'shell.exec',
			{
				command: 'rm',
				args: ['-rf', './.git'],
				preview: true,
			},
			c
		);

		expect(preview.preview).toBe(true);
		expect(preview.requiresConfirmation).toBe(true);
		expect(preview.confirmToken.length).toBeGreaterThan(0);

		// Even without preview, confirm is required to run
		const gate = await reg.run<{
			preview: boolean;
			requiresConfirmation: boolean;
			confirmToken: string;
			reasons: string[];
		}>(
			'shell.exec',
			{
				command: 'rm',
				args: ['-rf', './.git'],
			},
			c
		);
		expect(gate.preview).toBe(true);
		expect(gate.requiresConfirmation).toBe(true);
	});

	it('rejects cwd that escapes sandbox', async () => {
		await expect(
			reg.run(
				'shell.exec',
				{
					command: process.execPath,
					args: ['-e', 'process.exit(0)'],
					cwd: '..', // escape attempt
				},
				c
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('interactive mode does not throw on non-zero, returns result', async () => {
		const f = path.join(tmp, 'exit3.js');
		fs.writeFileSync(f, 'process.exit(3)', 'utf8');

		const res = await reg.run<{ ok: boolean; exitCode: number }>(
			'shell.exec',
			{
				command: process.execPath,
				args: [f],
				interactive: true,
			},
			c
		);

		expect(res.ok).toBe(false);
		expect(res.exitCode).toBe(3);
	});
});
