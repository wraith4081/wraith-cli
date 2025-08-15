import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCheckpointDiff } from '@checkpoints/diff';
import { createCheckpoint } from '@checkpoints/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmp(): string {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-diff-'));
	process.chdir(d);
	return d;
}
function write(p: string, s: string | Buffer) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s);
}

describe('checkpoints/diff', () => {
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

	it('diff between two checkpoints reports added/removed/modified with patches', async () => {
		write(path.join(proj, 'a.txt'), 'A1\n');
		write(path.join(proj, 'b.txt'), 'B1\n');
		const cp1 = await createCheckpoint(proj, { label: 'cp1' });

		// mutate: modify a, remove b, add c; include a binary-ish file too
		write(path.join(proj, 'a.txt'), 'A2\nextra\n');
		fs.rmSync(path.join(proj, 'b.txt'));
		write(path.join(proj, 'c.txt'), 'C1\n');
		write(path.join(proj, 'bin.dat'), Buffer.from([0, 1, 2, 3, 0, 255]));
		const cp2 = await createCheckpoint(proj, { label: 'cp2' });

		const res = await computeCheckpointDiff(
			proj,
			cp1.meta.id,
			cp2.meta.id,
			{ maxPatchLines: 200 }
		);
		expect(res.fromId).toBe(cp1.meta.id);
		expect(res.toId).toBe(cp2.meta.id);

		// stats
		expect(res.stats.added).toBeGreaterThanOrEqual(1);
		expect(res.stats.removed).toBeGreaterThanOrEqual(1);
		expect(res.stats.modified).toBeGreaterThanOrEqual(1);

		// entries sanity
		const by = (p: string) => res.entries.find((e) => e.path === p);
		expect(by('a.txt')?.status).toBe('modified');
		expect(by('b.txt')?.status).toBe('removed');
		expect(by('c.txt')?.status).toBe('added');

		// patch contains context for modified file
		const patch = by('a.txt')?.patch ?? '';
		expect(patch).toContain('--- a.txt');
		expect(patch).toContain('+++ a.txt');
		expect(patch).toMatch(/-A1/);
		expect(patch).toMatch(/\+A2/);

		// binary file that only appears in the second checkpoint is "added"
		expect(by('bin.dat')?.status).toBe('added');
	});

	it('diff against worktree works', async () => {
		write(path.join(proj, 'w.txt'), 'W1\n');
		const cp = await createCheckpoint(proj, { label: 'base' });

		// change worktree
		write(path.join(proj, 'w.txt'), 'W2\n');
		write(path.join(proj, 'new.txt'), 'N\n');

		const res = await computeCheckpointDiff(proj, cp.meta.id, 'worktree');
		const by = (p: string) => res.entries.find((e) => e.path === p);
		expect(by('w.txt')?.status).toBe('modified');
		expect(by('new.txt')?.status).toBe('added');
	});
});
