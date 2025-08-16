/** biome-ignore-all lint/suspicious/noExplicitAny: tbd */
import type { HotIndexLike } from '@rag/retrieval';
import { retrieveSimilar } from '@rag/retrieval';
import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';
import { describe, expect, it } from 'vitest';

function mkChunk(
	id: string,
	filePath: string,
	startLine: number,
	endLine: number,
	score: number
): RetrievedChunk {
	const emb: ChunkEmbedding = {
		id,
		filePath,
		startLine,
		endLine,
		model: 'text-embedding-3-large',
		vector: [1, 0, 0],
		dim: 3,
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
	return { chunk: emb, score, source: 'hot' };
}

class HotFake implements HotIndexLike {
	private hits: RetrievedChunk[];
	constructor(hits: RetrievedChunk[]) {
		this.hits = hits;
	}
	async search(): Promise<RetrievedChunk[]> {
		return await Promise.resolve(this.hits.slice());
	}
}

class ColdFake implements ColdIndexDriver {
	private hits: RetrievedChunk[];
	constructor(hits: RetrievedChunk[]) {
		this.hits = hits;
	}
	async init(): Promise<void> {
		return await Promise.resolve();
	}
	// upsert/delete not used in tests
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
		return await Promise.resolve();
	}
	async queryByVector(): Promise<
		Array<{ score: number; chunk: ChunkEmbedding }>
	> {
		return await Promise.resolve(this.hits.slice());
	}

	name = 'ColdFake';
}

describe('retrieveSimilar()', () => {
	it('returns hot-only when hotMin satisfied', async () => {
		const hot = new HotFake([
			mkChunk('a', 'A.ts', 1, 5, 0.98),
			mkChunk('b', 'B.ts', 10, 20, 0.9),
		]);
		const res = await retrieveSimilar(
			[1, 0, 0],
			{ hot, colds: [] },
			{ topK: 2, hotMin: 2 }
		);
		expect(res.hits.map((h) => h.chunk.id)).toEqual(['a', 'b']);
		expect(res.used).toEqual({ fromHot: 2, fromCold: 0 });
		expect(res.citations[0]).toContain('A.ts:1-5 (via hot)');
	});

	it('falls back to cold when hot insufficient', async () => {
		const hot = new HotFake([mkChunk('a', 'A.ts', 1, 5, 0.92)]);
		const cold1: any = new ColdFake([mkChunk('c1', 'C.ts', 3, 8, 0.88)]);
		const cold2: any = new ColdFake([mkChunk('c2', 'D.ts', 4, 9, 0.86)]);
		const res = await retrieveSimilar(
			[1, 0, 0],
			{ hot, colds: [cold1, cold2] },
			{ topK: 3 }
		);
		expect(res.hits.length).toBe(3);
		expect(res.used.fromHot).toBe(1);
		expect(res.used.fromCold).toBe(2);
		expect(res.citations.some((s) => s.endsWith('(via cold)'))).toBe(true);
	});

	it('dedupes by span and prefers hot on tie', async () => {
		// same span appears in hot and cold with equal scores
		const hot = new HotFake([mkChunk('hotX', 'X.ts', 2, 7, 0.9)]);
		const cold: any = new ColdFake([mkChunk('coldY', 'X.ts', 2, 7, 0.9)]);
		const res = await retrieveSimilar(
			[1, 0, 0],
			{ hot, colds: [cold] },
			{ topK: 5, dedupeBy: 'span' }
		);
		expect(res.hits.length).toBe(1);
		expect(res.hits[0].chunk.id).toBe('hotX');
		expect(res.citations[0]).toBe('X.ts:2-7 (via hot)');
	});

	it('applies scoreThreshold across sources', async () => {
		const hot = new HotFake([mkChunk('a', 'A.ts', 1, 5, 0.95)]);
		const cold: any = new ColdFake([
			mkChunk('ok', 'C.ts', 3, 8, 0.8),
			mkChunk('low', 'D.ts', 4, 9, 0.49),
		]);
		const res = await retrieveSimilar(
			[1, 0, 0],
			{ hot, colds: [cold] },
			{ topK: 5, scoreThreshold: 0.5 }
		);
		expect(res.hits.map((h) => h.chunk.id)).toEqual(['a', 'ok']);
		expect(res.citations.every((c) => !c.includes('D.ts'))).toBe(true);
	});

	it('dedupes by id when requested', async () => {
		const hot = new HotFake([mkChunk('same', 'P.ts', 1, 2, 0.7)]);
		const cold: any = new ColdFake([mkChunk('same', 'Q.ts', 10, 12, 0.9)]);
		const res = await retrieveSimilar(
			[1, 0, 0],
			{ hot, colds: [cold] },
			{ topK: 5, dedupeBy: 'id' }
		);
		expect(res.hits.length).toBe(1);
		expect(res.hits[0].chunk.filePath).toBe('Q.ts'); // higher score kept
	});
});
