import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	createCheckpoint,
	listCheckpointDirs,
	restoreCheckpoint,
} from '@checkpoints/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmpProject(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-proj-'));
	process.chdir(d);
	return d;
}

function write(p: string, s: string | Buffer) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s);
}

describe('checkpoints/store', () => {
	let cwd = process.cwd();
	let proj!: string;

	beforeEach(() => {
		cwd = process.cwd();
		proj = mkTmpProject();
	});

	afterEach(() => {
		try {
			fs.rmSync(proj, { recursive: true, force: true });
		} catch {
			//
		}
		process.chdir(cwd);
	});

	it('creates checkpoint and writes manifest, excluding .wraith/checkpoints/**', async () => {
		// Real file(s)
		write(path.join(proj, 'src', 'a.txt'), 'hello\n');
		// Simulate an existing checkpoint payload that must be ignored
		write(
			path.join(
				proj,
				'.wraith',
				'checkpoints',
				'fake',
				'files',
				'ghost.txt'
			),
			'ignore-me'
		);

		const { dir, manifestPath, meta } = await createCheckpoint(proj, {
			label: 'first',
		});
		expect(fs.existsSync(dir)).toBe(true);
		expect(fs.existsSync(manifestPath)).toBe(true);
		expect(meta.id).toBeTruthy();
		expect(meta.files).toBeGreaterThan(0);

		// Ensure ignored content didn’t leak into the snapshot
		const filesRoot = path.join(dir, 'files');
		const all = listFiles(filesRoot);
		const containsGhost = all.some((p) => p.endsWith('/ghost.txt'));
		expect(containsGhost).toBe(false);
	});

	it('restore dry-run lists overwrites; --force restores and creates backups', async () => {
		write(path.join(proj, 'note.txt'), 'v1');
		const cp1 = await createCheckpoint(proj, { label: 'one' });

		// change file so restore would overwrite
		write(path.join(proj, 'note.txt'), 'v2');

		const dry = await restoreCheckpoint(proj, cp1.meta.id, {
			dryRun: true,
		});
		expect(dry.restored).toBeGreaterThan(0);
		expect(dry.overwrites).toContain('note.txt');

		const done = await restoreCheckpoint(proj, cp1.meta.id, {
			force: true,
		});
		expect(done.backupDir).toBeTruthy();
		const backupFile = path.join(done.backupDir as string, 'note.txt');
		expect(fs.existsSync(backupFile)).toBe(true);

		// file content should match checkpoint (v1)
		const cur = fs.readFileSync(path.join(proj, 'note.txt'), 'utf8');
		expect(cur).toBe('v1');

		// sanity: listCheckpointDirs sees at least the created one
		const dirs = listCheckpointDirs();
		expect(dirs.length).toBeGreaterThan(0);
	});
});

// helper
function listFiles(root: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const abs = path.join(d, e.name);
			if (e.isDirectory()) {
				walk(abs);
			} else if (e.isFile()) {
				out.push(abs);
			}
		}
	};
	walk(root);
	return out.map((p) => p.split(path.sep).join('/'));
}
