import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatPreSendSummary, ingestPaths } from '@ingest/limits';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-ing-'));
}

function write(p: string, content: string | Buffer) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, content);
}

describe('Ingestion limits and summaries', () => {
	let root: string;
	beforeEach(() => {
		root = mkTmp();
	});
	afterEach(() => {
		try {
			fs.rmSync(root, { recursive: true, force: true });
		} catch {
			//
		}
	});

	it('includes small text files and estimates tokens', () => {
		const a = path.join(root, 'src', 'a.txt');
		write(a, 'hello world');
		const res = ingestPaths({
			rootDir: root,
			paths: ['src'],
			config: {
				version: '1',
				defaults: { ingestion: { ignore: { useGitIgnore: false } } },
			},
		});
		expect(res.included.length).toBe(1);
		expect(res.included[0]?.relPath).toBe('src/a.txt');
		expect(res.included[0]?.tokenEstimate).toBeGreaterThan(0);
		const summary = formatPreSendSummary(res);
		expect(summary).toContain('Context attachments: 1/1 files included');
	});

	it('skips oversize files', () => {
		const big = path.join(root, 'data', 'big.txt');
		write(big, 'x'.repeat(1024 * 1024 + 10)); // > 1 MiB default
		const res = ingestPaths({
			rootDir: root,
			paths: ['data'],
			config: {
				version: '1',
				defaults: { ingestion: { ignore: { useGitIgnore: false } } },
			},
		});
		expect(res.included.length).toBe(0);
		expect(res.skipped.some((s) => s.reason === 'oversize')).toBe(true);
		const summary = formatPreSendSummary(res);
		expect(summary).toContain('Skipped');
	});

	it('respects maxFiles limit', () => {
		write(path.join(root, 'f1.txt'), '1');
		write(path.join(root, 'f2.txt'), '2');
		write(path.join(root, 'f3.txt'), '3');
		const res = ingestPaths({
			rootDir: root,
			paths: ['.'],
			config: {
				version: '1',
				defaults: {
					ingestion: { ignore: { useGitIgnore: false }, maxFiles: 2 },
				},
			},
		});
		expect(
			res.included.length +
				res.skipped.filter((s) => s.reason === 'maxFiles').length
		).toBeGreaterThanOrEqual(2);
		expect(res.skipped.some((s) => s.reason === 'maxFiles')).toBe(true);
	});

	it('applies binaryPolicy=skip', () => {
		const bin = path.join(root, 'image.bin');
		// Contains null bytes
		write(bin, Buffer.from([0x00, 0x01, 0x02, 0x03]));
		const res = ingestPaths({
			rootDir: root,
			paths: ['.'],
			config: {
				version: '1',
				defaults: {
					ingestion: {
						ignore: { useGitIgnore: false },
						binaryPolicy: 'skip',
					},
				},
			},
		});
		expect(res.included.length).toBe(0);
		expect(res.skipped.some((s) => s.reason === 'binary')).toBe(true);
	});

	it('applies binaryPolicy=hash', () => {
		const bin = path.join(root, 'bin.dat');
		write(bin, Buffer.from([0xde, 0xad, 0xbe, 0xef]));
		const res = ingestPaths({
			rootDir: root,
			paths: ['.'],
			config: {
				version: '1',
				defaults: {
					ingestion: {
						ignore: { useGitIgnore: false },
						binaryPolicy: 'hash',
					},
				},
			},
		});
		const meta = res.skipped.find((s) => s.relPath.endsWith('bin.dat'));
		expect(meta?.hashSha256).toBeTypeOf('string');
		expect((meta?.hashSha256 ?? '').length).toBeGreaterThan(0);
	});

	it('honors .gitignore via defaults', () => {
		fs.writeFileSync(path.join(root, '.gitignore'), 'ignored/\n', 'utf8');
		write(path.join(root, 'ignored', 'z.txt'), 'foo');
		write(path.join(root, 'ok.txt'), 'bar');
		const res = ingestPaths({
			rootDir: root,
			paths: ['.'],
			config: { version: '1' }, // schema defaults: useGitIgnore true
		});
		expect(res.included.some((a) => a.relPath === 'ignored/z.txt')).toBe(
			false
		);
		expect(res.included.some((a) => a.relPath === 'ok.txt')).toBe(true);
	});
});
