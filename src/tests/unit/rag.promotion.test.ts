import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HotIndex } from '@rag/hot-index';
import { retrieveWithPromotion } from '@rag/promotion';
import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';
import { describe, expect, it } from 'vitest';

function mkEmb(id: string, v: number[]): ChunkEmbedding {
	return {
		id,
		filePath: 'x.ts',
		startLine: 1,
		endLine: 1,
		model: 'text-embedding-3-large',
		vector: v,
		dim: v.length,
		tokensEstimated: 0,
		chunkRef: {
			filePath: 'x.ts',
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

class ColdFake implements ColdIndexDriver {
	private readonly hits: RetrievedChunk[];

	constructor(h: RetrievedChunk[]) {
		this.hits = h;
	}

	async init(): Promise<void> {
		//
	}

	// biome-ignore lint/suspicious/noExplicitAny: tbd
	async upsert(): Promise<any> {
		return await Promise.resolve(0);
	}

	async deleteByIds(): Promise<number> {
		return await Promise.resolve(0);
	}

	async search(): Promise<RetrievedChunk[]> {
		return await Promise.resolve(this.hits.slice());
	}

	async close(): Promise<void> {
		//
	}

	async queryByVector(): Promise<
		Array<{ score: number; chunk: ChunkEmbedding }>
	> {
		return await Promise.resolve([]);
	}

	name = 'cold';
}

describe('retrieveWithPromotion', () => {
	it('promotes cold hits after threshold and then serves from hot', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-promote-'));
		const hot = new HotIndex({
			baseDir: dir,
			capacity: 2,
			writeThroughMs: 0,
		});

		const cold = new ColdFake([
			{ chunk: mkEmb('c1', [1, 0, 0]), score: 0.99, source: 'qdrant' },
		]);

		// First two calls: below threshold (default 3) -> still cold
		for (let i = 0; i < 2; i++) {
			const r = await retrieveWithPromotion(
				[1, 0, 0],
				{ hot, colds: [cold] },
				{ topK: 1 }
			);
			expect(r.hits[0].chunk.id).toBe('c1');
			// citation may say "via cold" on these initial calls
		}

		// Third call crosses threshold -> promoted to hot after call
		await retrieveWithPromotion(
			[1, 0, 0],
			{ hot, colds: [cold] },
			{ topK: 1 }
		);

		// Now, with NO colds, hot alone should return the same chunk
		const rHotOnly = await retrieveWithPromotion(
			[1, 0, 0],
			{ hot, colds: [] },
			{ topK: 1 }
		);
		expect(rHotOnly.hits[0].chunk.id).toBe('c1');

		// cleanup
		fs.rmSync(dir, { recursive: true, force: true });
	});
});
