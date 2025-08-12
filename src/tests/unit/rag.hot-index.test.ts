import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HotIndex } from '@rag/hot-index';
import type { ChunkEmbedding } from '@rag/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmpDir(prefix = 'wraith-hotindex-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function emb(
	id: string,
	vector: number[],
	model = 'm1',
	filePath = 'src/a.ts',
	startLine = 1,
	endLine = 10
): ChunkEmbedding {
	return {
		id,
		filePath,
		startLine,
		endLine,
		model,
		vector,
		dim: vector.length,
		tokensEstimated: 10,
		chunkRef: {
			filePath,
			startLine,
			endLine,
			chunkIndex: 0,
			chunkCount: 1,
			sha256: id,
			content: '',
			tokensEstimated: 10,
			fileType: 'text',
		},
	};
}

describe('HotIndex', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it('upserts and queries by cosine similarity', () => {
		const idx = new HotIndex({ dir: tmp, maxSize: 10, autosave: false });

		// v1 ~ [1,0], v2 ~ [0,1], v3 ~ [1,1]
		idx.upsert([emb('A', [1, 0]), emb('B', [0, 1]), emb('C', [1, 1])]);

		// Query along x-axis -> A highest, then C, then B
		const res = idx.query({ vector: [1, 0], topK: 3 });
		expect(res.length).toBe(3);
		expect(res[0].item.id).toBe('A');
		expect(res[1].item.id).toBe('C');
		expect(res[2].item.id).toBe('B');

		// modelFilter keeps only matching model
		const resFiltered = idx.query({
			vector: [1, 0],
			topK: 3,
			modelFilter: 'm1',
		});
		expect(resFiltered.length).toBe(3);
	});

	it('evicts least-used (then oldest) when capacity exceeded', () => {
		const idx = new HotIndex({ dir: tmp, maxSize: 2, autosave: false });

		idx.upsert([emb('A', [1, 0]), emb('B', [0, 1])]);

		// Bump usage of B only (topK=1 so only the best gets a 'use')
		idx.query({ vector: [0, 1], topK: 1 });

		// Insert C -> capacity exceeded; should evict A (uses=0), keep B (uses=1)
		idx.upsert([emb('C', [1, 1])]);

		expect(idx.size()).toBe(2);
		expect(idx.has('B')).toBeTruthy();
		expect(idx.has('C')).toBeTruthy();
		expect(idx.has('A')).toBeFalsy();
	});

	it('persists to disk and reloads', () => {
		const file = 'index.json';
		const idx1 = new HotIndex({ dir: tmp, autosave: true, filename: file });
		idx1.upsert([emb('A', [0.5, 0.5])]);

		const idx2 = new HotIndex({
			dir: tmp,
			autosave: false,
			filename: file,
		});
		expect(idx2.size()).toBe(1);
		expect(idx2.has('A')).toBeTruthy();
	});
});
