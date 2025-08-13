import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolPermissionError } from '@tools/errors';
import { registerFsTools } from '@tools/fs';
import { ToolRegistry } from '@tools/registry';
import type { ToolContext } from '@tools/types';
import { createTwoFilesPatch } from 'diff';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function ctx(cwd: string): ToolContext {
	return {
		cwd,
		policy: {
			allowPermissions: ['fs'],
		},
	};
}

function write(p: string, s: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s, 'utf8');
}

let tmp: string;
let reg: ToolRegistry;
let c: ToolContext;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-fs-'));
	reg = new ToolRegistry();
	registerFsTools(reg);
	c = ctx(tmp);
});

afterEach(() => {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe('fs tools', () => {
	it('list + read basic flow', async () => {
		const f = path.join(tmp, 'src', 'a.txt');
		write(f, 'hello\nworld');
		const listing = await reg.run<{ entries: Array<{ path: string }> }>(
			'fs.list',
			{ path: 'src', recursive: true },
			c
		);
		expect(listing.entries.some((e) => e.path.endsWith('/a.txt'))).toBe(
			true
		);

		const read = await reg.run<{ content: string }>(
			'fs.read',
			{ path: 'src/a.txt' },
			c
		);
		expect(read.content).toContain('hello');
	});

	it('write with preview diff, then write', async () => {
		const f = path.join(tmp, 'notes.md');
		write(f, 'old');

		const preview = await reg.run<{ preview: boolean; diff: string }>(
			'fs.write',
			{
				path: 'notes.md',
				content: 'new content',
				preview: true,
			},
			c
		);
		expect(preview.preview).toBe(true);
		expect(preview.diff).toContain('new content');

		const done = await reg.run<{ written: boolean }>(
			'fs.write',
			{
				path: 'notes.md',
				content: 'new content',
				overwrite: true,
			},
			c
		);
		expect(done.written).toBe(true);

		const read = await reg.run<{ content: string }>(
			'fs.read',
			{ path: 'notes.md' },
			c
		);
		expect(read.content).toBe('new content');
	});

	it('append with preview diff', async () => {
		const f = path.join(tmp, 'log.txt');
		write(f, 'line1\n');
		const p = await reg.run<{ preview: boolean; diff: string }>(
			'fs.append',
			{
				path: 'log.txt',
				content: 'line2\n',
				preview: true,
			},
			c
		);
		expect(p.preview).toBe(true);
		expect(p.diff).toContain('line2');

		await reg.run('fs.append', { path: 'log.txt', content: 'line2\n' }, c);
		const read = await reg.run<{ content: string }>(
			'fs.read',
			{ path: 'log.txt' },
			c
		);
		expect(read.content).toBe('line1\nline2\n');
	});

	it('search finds matches (substring and regex)', async () => {
		const f = path.join(tmp, 'src', 'a.ts');
		write(f, 'const Alpha = 1;\n// alpha beta\n');
		const s1 = await reg.run<{ matches: Array<{ file: string }> }>(
			'fs.search',
			{
				root: 'src',
				query: 'alpha',
				caseSensitive: false,
			},
			c
		);
		expect(s1.matches.length).toBeGreaterThan(0);

		const s2 = await reg.run<{ matches: Array<{ file: string }> }>(
			'fs.search',
			{
				root: 'src',
				query: '^const\\s+Alpha',
				regex: true,
				caseSensitive: true,
			},
			c
		);
		expect(s2.matches.length).toBe(1);
		expect(s2.matches[0]?.file.endsWith('/a.ts')).toBe(true);
	});

	it('patch applies unified diff and supports preview', async () => {
		const f = path.join(tmp, 'code.js');
		write(f, 'console.log("a");\n');

		const before = 'console.log("a");\n';
		const after = 'console.log("b");\n';
		const patch = createTwoFilesPatch(
			'code.js',
			'code.js',
			before,
			after,
			'before',
			'after'
		);

		const prev = await reg.run<{ preview: boolean; diff: string }>(
			'fs.patch',
			{
				path: 'code.js',
				patch,
				preview: true,
			},
			c
		);
		expect(prev.preview).toBe(true);
		expect(prev.diff).toContain('console.log("b");');

		const applied = await reg.run<{ applied: boolean }>(
			'fs.patch',
			{
				path: 'code.js',
				patch,
			},
			c
		);
		expect(applied.applied).toBe(true);

		const read = await reg.run<{ content: string }>(
			'fs.read',
			{ path: 'code.js' },
			c
		);
		expect(read.content).toContain('"b"');
	});

	it('blocks path escapes', async () => {
		await expect(
			reg.run('fs.read', { path: '../outside.txt' }, c)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});

	it('refuses to edit binary files', async () => {
		const f = path.join(tmp, 'bin.dat');
		fs.writeFileSync(f, Buffer.from([0, 1, 2, 3, 0, 255]));
		await expect(
			reg.run('fs.write', { path: 'bin.dat', content: 'x' }, c)
		).rejects.toBeInstanceOf(ToolPermissionError);
		await expect(
			reg.run('fs.append', { path: 'bin.dat', content: 'x' }, c)
		).rejects.toBeInstanceOf(ToolPermissionError);
		await expect(
			reg.run(
				'fs.patch',
				{ path: 'bin.dat', patch: '--- a\n+++ b\n@@\n-1\n+2\n' },
				c
			)
		).rejects.toBeInstanceOf(ToolPermissionError);
	});
});
