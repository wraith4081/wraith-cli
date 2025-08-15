import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCheckpoint, restoreCheckpoint } from '@checkpoints/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkProj(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-chkpt-'));
	process.chdir(d);
	return d;
}

describe('checkpoints/store', () => {
	let cwd = process.cwd();
	let proj = '';
	beforeEach(() => {
		cwd = process.cwd();
		proj = mkProj();
		fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
		fs.writeFileSync(path.join(proj, 'src', 'a.txt'), 'A1\n', 'utf8');
		fs.writeFileSync(path.join(proj, 'readme.md'), '# readme\n', 'utf8');
	});
	afterEach(() => {
		process.chdir(cwd);
		try {
			fs.rmSync(proj, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it('creates and restores a checkpoint', async () => {
		const mk = await createCheckpoint(proj, { label: 'smoke' });
		expect(fs.existsSync(mk.dir)).toBeTruthy();
		expect(fs.existsSync(mk.manifestPath)).toBeTruthy();
		expect(mk.meta.files).toBeGreaterThan(0);

		// change a file
		fs.writeFileSync(path.join(proj, 'src', 'a.txt'), 'A2\n', 'utf8');

		// dry-run should report overwrite
		const dry = await restoreCheckpoint(proj, mk.meta.id, { dryRun: true });
		expect(dry.restored).toBeGreaterThan(0);
		expect(dry.overwrites.some((p) => p.endsWith('src/a.txt'))).toBe(true);

		// actual restore
		const out = await restoreCheckpoint(proj, mk.meta.id, { force: true });
		expect(out.restored).toBeGreaterThan(0);
		expect(out.checkpointId).toBe(mk.meta.id);
		expect(fs.readFileSync(path.join(proj, 'src', 'a.txt'), 'utf8')).toBe(
			'A1\n'
		);
	});
});
