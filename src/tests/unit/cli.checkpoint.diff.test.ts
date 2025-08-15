/** biome-ignore-all lint/suspicious/noConsole: CLI test */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckpoint } from '@checkpoints/store';
import { registerCheckpointsCommand } from '@cli/commands/checkpoints';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mkTmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-cli-'));
	process.chdir(d);
	return d;
}
function write(p: string, s: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s, 'utf8');
}

describe('CLI: checkpoint diff', () => {
	let cwd = process.cwd();
	let proj!: string;

	beforeEach(() => {
		cwd = process.cwd();
		proj = mkTmp();
	});
	afterEach(() => {
		try {
			fs.rmSync(proj, { recursive: true, force: true });
		} catch {
			//
		}
		process.chdir(cwd);
	});

	it('prints JSON result', async () => {
		write(path.join(proj, 'x.txt'), 'v1\n');
		const cp1 = await createCheckpoint(proj, { label: 'one' });
		write(path.join(proj, 'x.txt'), 'v2\n');
		const cp2 = await createCheckpoint(proj, { label: 'two' });

		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		const err = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);

		const program = new Command();
		program.exitOverride(); // don’t exit test process
		registerCheckpointsCommand(program);

		await program.parseAsync([
			'node',
			'ai',
			'checkpoint',
			'diff',
			cp1.meta.id,
			cp2.meta.id,
			'--json',
		]);

		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		expect(printed).toMatch(/"fromId":/);
		expect(printed).toMatch(/"toId":/);
		expect(printed).toMatch(/"entries":/);

		out.mockRestore();
		err.mockRestore();
	});
});
