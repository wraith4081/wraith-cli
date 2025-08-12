import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	chunkFileContent,
	detectFileType,
	ingestAndChunkPaths,
} from '@ingest/chunking';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmp(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-chunk-'));
}

function write(p: string, text: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, text, 'utf8');
}

describe('chunking', () => {
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

	it('detects file types by extension and content', () => {
		expect(detectFileType('readme.md', '# H1')).toBe('markdown');
		expect(detectFileType('file.json', '{"a":1}')).toBe('json');
		expect(detectFileType('code.ts', 'export const x=1;')).toBe('code');
		expect(detectFileType('plain.txt', 'hello world')).toBe('text');
		// content-based markdown fallback
		expect(detectFileType('noext', '# title')).toBe('markdown');
	});

	it('chunks markdown without splitting inside code fences', () => {
		const md = [
			'# Title',
			'',
			'Intro text',
			'',
			'```ts',
			'const x = 1;',
			'```',
			'',
			'More text',
			'',
			'## Next',
			'Text after',
		].join('\n');
		const chunks = chunkFileContent('doc.md', md, {
			chunkSizeTokens: 8,
			overlapTokens: 0,
		});
		// Very small budget forces multiple chunks, ensure fence lines stay together
		const hasFenceSplit = chunks.some(
			(c) => /```/.test(c.content) && !/```[\s\S]*```/.test(c.content)
		);
		expect(hasFenceSplit).toBe(false);
	});

	it('applies overlap between chunks', () => {
		const lines = Array.from(
			{ length: 200 },
			(_, i) => `line ${i + 1}`
		).join('\n');
		const chunks = chunkFileContent('file.txt', lines, {
			chunkSizeTokens: 40,
			overlapTokens: 10,
		});
		expect(chunks.length).toBeGreaterThan(1);
		// The last lines of chunk[i] should appear in chunk[i+1]
		const c0 = chunks[0].content.split('\n').slice(-5).join('\n');
		const c1 = chunks[1].content;
		expect(
			c1.includes(c0.split('\n')[0] ?? '') ||
				c1.includes(c0.split('\n')[1] ?? '')
		).toBe(true);
	});

	it('caps number of chunks per file and warns via summary', () => {
		const long = Array.from({ length: 10_000 }, (_, i) => `L${i}`).join(
			'\n'
		);
		write(path.join(root, 'big.txt'), long);
		const res = ingestAndChunkPaths({
			rootDir: root,
			paths: ['.'],
			config: {
				version: '1',
				defaults: { ingestion: { ignore: { useGitIgnore: false } } },
			},
			chunking: {
				chunkSizeTokens: 20,
				overlapTokens: 0,
				maxChunksPerFile: 5,
			},
		});
		expect(res.chunks.length).toBeLessThanOrEqual(5);
		expect(
			res.warnings.some((w) => /truncated to maxChunksPerFile=5/.test(w))
		).toBe(true);
	});

	it('integrates with ingestPaths and produces provenance metadata', () => {
		const code = Array.from(
			{ length: 200 },
			(_, i) => `function f${i}(){return ${i};}`
		).join('\n');
		write(path.join(root, 'src', 'app.ts'), code);
		const res = ingestAndChunkPaths({
			rootDir: root,
			paths: ['src'],
			config: {
				version: '1',
				defaults: { ingestion: { ignore: { useGitIgnore: false } } },
			},
			chunking: { chunkSizeTokens: 80, overlapTokens: 10 },
		});
		expect(res.chunks.length).toBeGreaterThan(0);
		const c = res.chunks[0];
		expect(c.filePath).toBe('src/app.ts');
		expect(c.startLine).toBeGreaterThan(0);
		expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
		expect(c.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(c.tokensEstimated).toBeGreaterThan(0);
	});
});
