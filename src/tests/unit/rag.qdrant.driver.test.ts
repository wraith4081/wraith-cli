import { QdrantDriver } from '@rag/drivers/qdrant';
import type { ChunkEmbedding } from '@rag/types';
import { beforeEach, describe, expect, it } from 'vitest';

type Point = { id: string; vector: number[]; payload: Record<string, unknown> };

class FakeClient {
	private cols = new Map<
		string,
		{ config: unknown; points: Map<string, Point> }
	>();

	private require(name: string) {
		const c = this.cols.get(name);
		if (!c) {
			throw new Error('missing collection');
		}
		return c;
	}

	collections = {
		get: (name: string) => {
			const c = this.cols.get(name);
			if (!c) {
				throw new Error('not found');
			}
			return { result: c.config };
		},
		create: (name: string, payload: unknown) => {
			if (!this.cols.has(name)) {
				this.cols.set(name, {
					config: payload,
					points: new Map<string, Point>(),
				});
			}
			return { result: { created: true } };
		},
	};

	points = {
		upsert: (name: string, payload: { points: Point[] }) => {
			const c = this.require(name);
			for (const p of payload.points) {
				c.points.set(String(p.id), {
					id: String(p.id),
					vector: p.vector.slice(),
					payload: { ...(p.payload ?? {}) },
				});
			}
			return { result: { upserted: payload.points.length } };
		},
		search: (
			name: string,
			payload: {
				limit?: number;
				vector: number[];
				filter?: {
					must?: Array<{ key: string; match: { value: string } }>;
				};
				with_vector?: boolean;
			}
		) => {
			const c = this.require(name);
			const qv: number[] = payload.vector;
			const limit = Number(payload.limit ?? 10);
			const mustModel = payload.filter?.must?.find(
				(m) => m.key === 'model'
			)?.match.value;

			const scored = Array.from(c.points.values())
				.filter((p) =>
					mustModel
						? String(p.payload.model ?? '') === mustModel
						: true
				)
				.map((p) => ({ ...p, score: cosine(qv, p.vector) }))
				.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
				.slice(0, limit)
				.map((r) => ({
					id: r.id,
					payload: r.payload,
					vector: payload.with_vector ? r.vector : undefined,
					score: r.score,
				}));

			return { result: scored };
		},
		delete: (name: string, payload: { points: Array<string | number> }) => {
			const c = this.require(name);
			for (const id of payload.points) {
				c.points.delete(String(id));
			}
			return { result: { deleted: payload.points.length } };
		},
	};
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	const den = Math.sqrt(na) * Math.sqrt(nb);
	return den > 0 ? dot / den : 0;
}

function chunk(
	id: string,
	vec: number[],
	model = 'text-embedding-3-large'
): ChunkEmbedding {
	return {
		id,
		filePath: 'src/file.ts',
		startLine: 1,
		endLine: 10,
		model,
		vector: vec,
		dim: vec.length,
		tokensEstimated: 10,
		chunkRef: {
			filePath: 'src/file.ts',
			startLine: 1,
			endLine: 10,
			chunkIndex: 0,
			chunkCount: 1,
			sha256: id,
			content: '',
			tokensEstimated: 10,
			fileType: 'text',
		},
	};
}

describe('QdrantDriver (mocked client)', () => {
	let driver: QdrantDriver;

	beforeEach(() => {
		driver = new QdrantDriver({
			url: 'http://fake:6333',
			collection: 'wraith_chunks_test',
			connectImpl: async () =>
				new FakeClient() as unknown as {
					collections: QdrantDriver extends Record<string, unknown>
						? never
						: unknown; // unused, only for shape
				},
		});
	});

	it('creates collection on first upsert (infers dim) and returns nearest neighbor on search', async () => {
		await driver.upsert([chunk('a', [1, 0, 0]), chunk('b', [0.9, 0.1, 0])]);

		const hits = await driver.search([1, 0, 0], { topK: 1 });
		expect(hits.length).toBe(1);
		expect(hits[0].chunk.id).toBe('a');
		expect((hits[0].score ?? 0) > 0.99).toBeTruthy();
		expect(hits[0].chunk.vector.length).toBe(3);
	});

	it('respects model filter and score threshold', async () => {
		await driver.upsert([
			chunk('mA', [1, 0], 'mA'),
			chunk('mB', [1, 0], 'mB'),
			chunk('low', [0.3, 0.7], 'mA'),
		]);

		const hitsA = await driver.search([1, 0], {
			modelFilter: 'mA',
			topK: 10,
			scoreThreshold: 0.5,
		});
		const idsA = hitsA.map((h) => h.chunk.id);
		expect(idsA).toContain('mA');
		expect(idsA).not.toContain('mB');
		expect(idsA).not.toContain('low');
	});

	it('deleteByIds removes points', async () => {
		await driver.upsert([chunk('x', [0, 1]), chunk('y', [1, 0])]);
		const n = await driver.deleteByIds(['x']);
		expect(n).toBe(1);

		const hits = await driver.search([0, 1], { topK: 2 });
		const ids = hits.map((h) => h.chunk.id);
		expect(ids).not.toContain('x');
		expect(ids).toContain('y');
	});
});
