import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HotIndex } from '@rag/hot-index';
import { retrieveByEmbedding } from '@rag/retrieval';
import type { ChunkEmbedding, ColdIndexDriver } from '@rag/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

function mkTmpDir(prefix = 'wraith-retrieval-') {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function emb(
	id: string,
	vector: number[],
	model = 'm1',
	filePath = 'src/doc.md',
	startLine = 1,
	endLine = 20
): ChunkEmbedding {
	return {
		id,
		filePath,
		startLine,
		endLine,
		model,
		vector,
		dim: vector.length,
		tokensEstimated: 12,
		chunkRef: {
			filePath,
			startLine,
			endLine,
			chunkIndex: 0,
			chunkCount: 1,
			sha256: id,
			content: '',
			tokensEstimated: 12,
			fileType: 'text',
		},
	};
}

function makeColdDriver(
	name: string,
	results: Array<{ score: number; chunk: ChunkEmbedding }>
): ColdIndexDriver {
	return {
		name,
		async upsert() {
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			return (await Promise.resolve(0)) as any;
		},
		async queryByVector() {
			return await Promise.resolve(results);
		},
	};
}

describe('retrieval pipeline (hot-first then cold, merge/dedupe, promotion)', () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkTmpDir();
	});

	afterEach(() => {
		fs.rmSync(tmp, { recursive: true, force: true });
	});

	it('queries cold when hot is insufficient and promotes cold winners into hot', async () => {
		const hot = new HotIndex({ dir: tmp, autosave: false, maxSize: 10 });

		// Hot is empty -> forces cold query due to minResults
		const cold = makeColdDriver('mock', [
			{ score: 0.9, chunk: emb('X', [1, 0], 'm1', 'src/x.ts') },
			{ score: 0.8, chunk: emb('Y', [0, 1], 'm1', 'src/y.ts') },
		]);

		const res = await retrieveByEmbedding([1, 0], {
			hot,
			colds: [cold],
			topKHot: 4,
			topK: 2,
			minResults: 2,
			modelFilter: 'm1',
			promoteFromCold: true,
		});

		expect(res.items.length).toBe(2);
		expect(res.fromCold).toBe(2);
		// promoted to hot
		expect(hot.has('X')).toBeTruthy();
		expect(hot.has('Y')).toBeTruthy();
	});

	it('prefers hot hit over cold duplicate (dedupe keeps higher score and marks source)', async () => {
		const hot = new HotIndex({ dir: tmp, autosave: false, maxSize: 10 });
		// Put an item in hot that's quite aligned with the query
		hot.upsert([emb('DUP', [1, 0], 'm1', 'src/dup.md')]);

		// Cold returns the same id but with lower score scenario
		const cold = makeColdDriver('mock', [
			{ score: 0.2, chunk: emb('DUP', [0.2, 0], 'm1', 'src/dup.md') },
		]);

		const res = await retrieveByEmbedding([1, 0], {
			hot,
			colds: [cold],
			topKHot: 4,
			topK: 3,
			minResults: 1,
			modelFilter: 'm1',
		});

		expect(res.items.length).toBeGreaterThan(0);
		const top = res.items.find((i) => i.id === 'DUP');
		expect(top).toBeTruthy();
		expect(top?.source).toBe('hot');
		expect(res.fromCold).toBe(0); // deduped
	});

	it('respects model filter and score threshold', async () => {
		const hot = new HotIndex({ dir: tmp, autosave: false, maxSize: 10 });
		hot.upsert([emb('A', [0.1, 0.0], 'm2')]); // different model -> should be filtered out

		const cold = makeColdDriver('mock', [
			{ score: 0.3, chunk: emb('B', [0.3, 0.0], 'm1') }, // below threshold -> drop
			{ score: 0.7, chunk: emb('C', [0.7, 0.0], 'm1') }, // above threshold -> keep
			{ score: 0.6, chunk: emb('D', [0.6, 0.0], 'm2') }, // wrong model -> drop
		]);

		const res = await retrieveByEmbedding([1, 0], {
			hot,
			colds: [cold],
			modelFilter: 'm1',
			scoreThreshold: 0.5,
			topKHot: 4,
			topK: 5,
			minResults: 2,
			promoteFromCold: true,
		});

		const ids = res.items.map((i) => i.id);
		expect(ids).toEqual(['C']); // only C passes both filters
		expect(hot.has('C')).toBeTruthy(); // promoted
		expect(hot.has('B')).toBeFalsy();
		expect(hot.has('D')).toBeFalsy();
		expect(hot.has('A')).toBeTruthy(); // still there, just filtered out by model
	});
});
