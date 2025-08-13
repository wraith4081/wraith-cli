import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HotIndex } from '@rag/hot-index';
import type { ChunkEmbedding } from '@rag/types';
import { describe, expect, it } from 'vitest';

function mkChunk(id: string, vec: number[], model = 'm'): ChunkEmbedding {
	return {
		id,
		filePath: 'f',
		startLine: 1,
		endLine: 1,
		model,
		vector: vec,
		dim: vec.length,
		tokensEstimated: 0,
		chunkRef: {
			filePath: 'f',
			startLine: 1,
			endLine: 1,
			chunkIndex: 0,
			chunkCount: 1,
			sha256: id,
			content: '',
			tokensEstimated: 0,
			fileType: 'text',
		},
	};
}

describe('HotIndex', () => {
	it('upserts, searches, records usage, and evicts least-used', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-hot-'));
		const hot = new HotIndex({
			baseDir: dir,
			capacity: 2,
			writeThroughMs: 0,
		});

		await hot.upsert([mkChunk('a', [1, 0]), mkChunk('b', [0, 1])]);

		// favor 'a' for usage and similarity
		const hits = await hot.search([1, 0], { topK: 1 });
		expect(hits[0].chunk.id).toBe('a');

		// access 'a' again to bump usage
		await hot.search([1, 0], { topK: 1 });

		// insert 'c' and trigger eviction (capacity 2)
		await hot.upsert([mkChunk('c', [0, 1])]);

		// 'b' should be evicted (lower usage than 'a')
		const res = await hot.search([0, 1], { topK: 2 });
		const ids = res.map((h) => h.chunk.id);
		expect(ids).toContain('c');
		expect(ids).not.toContain('b');

		// cleanup
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
