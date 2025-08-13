import { LanceDBDriver } from '@rag/drivers/lancedb';
import type { ChunkEmbedding } from '@rag/types';
import { beforeEach, expect, test } from 'vitest';

// --- simple in-memory fake LanceDB ---
type Row = {
	id: string;
	vector: number[];
	model?: string;
	filePath?: string;
	startLine?: number;
	endLine?: number;
	dim?: number;
	tokensEstimated?: number;
};

class FakeTable {
	rows = new Map<string, Row>();

	add(data: Row[]) {
		let n = 0;
		for (const r of data) {
			if (!this.rows.has(r.id)) {
				n++;
			}
			this.rows.set(r.id, r);
		}
		return n;
	}
	mergeInsert(on: string, data: Row[]) {
		for (const r of data) {
			this.rows.set(String((r as Record<string, unknown>)[on]), r);
		}
	}
	search(vec: number[]) {
		const self = this;
		let where: ((r: Row) => boolean) | null = null;
		let lim = 10;
		const api = {
			where(pred: string) {
				const m = /model\s*=\s*'([^']+)'/.exec(pred);
				if (m) {
					where = (r: Row) => String(r.model) === m[1];
				}
				return api;
			},
			limit(k: number) {
				lim = k;
				return api;
			},
			toArray() {
				const all = [...self.rows.values()].filter((r) =>
					where ? where(r) : true
				);
				const scored = all
					.map((r) => ({
						...r,
						score: cosine(vec, r.vector),
					}))
					.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
				return scored.slice(0, lim);
			},
		};
		return api;
	}
}
class FakeDB {
	tables = new Map<string, FakeTable>();
	openTable(name: string) {
		const t = this.tables.get(name);
		if (!t) {
			throw new Error('missing');
		}
		return t;
	}
	createEmptyTable(name: string) {
		const t = new FakeTable();
		this.tables.set(name, t);
		return t;
	}
	createTable(name: string) {
		const t = new FakeTable();
		this.tables.set(name, t);
		return t;
	}
}
function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < a.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	const den = Math.sqrt(na) * Math.sqrt(nb);
	return den > 0 ? dot / den : 0;
}

// --- tests ---
let driver: LanceDBDriver;

beforeEach(() => {
	const fake = new FakeDB();
	driver = new LanceDBDriver({
		baseDir: '/tmp/lancedb-test',
		connectImpl: async () =>
			fake as unknown as {
				openTable: (name: string) => Promise<FakeTable>;
				createEmptyTable: (
					name: string,
					schema: unknown,
					opts?: unknown
				) => Promise<FakeTable>;
				createTable: (
					name: string,
					data: unknown
				) => Promise<FakeTable>;
			},
		buildArrowSchemaImpl: () => ({}),
	});
});

test('upsert + search returns nearest neighbor', async () => {
	const base = makeChunk('a', [1, 0, 0], 'text-embedding-3-large');
	const b = makeChunk('b', [0.9, 0.1, 0], 'text-embedding-3-large');
	await driver.upsert([base, b]);

	const hits = await driver.search([1, 0, 0], { topK: 1 });
	expect(hits.length).toBe(1);
	expect(hits[0]?.chunk.id).toBe('a');
	expect((hits[0]?.score ?? 0) > 0.99).toBeTruthy();
});

test('modelFilter constrains results', async () => {
	await driver.upsert([
		makeChunk('m1', [1, 0], 'mA'),
		makeChunk('m2', [1, 0], 'mB'),
	]);
	const hitsA = await driver.search([1, 0], { modelFilter: 'mA', topK: 5 });
	const hitsB = await driver.search([1, 0], { modelFilter: 'mB', topK: 5 });

	expect(hitsA.map((h) => h.chunk.id)).toEqual(['m1']);
	expect(hitsB.map((h) => h.chunk.id)).toEqual(['m2']);
});

test('upsert replaces row with same id', async () => {
	await driver.upsert([makeChunk('x', [0, 1], 'm')]);
	await driver.upsert([makeChunk('x', [1, 0], 'm')]); // same id, new vector
	const hits = await driver.search([1, 0], { topK: 1 });
	expect(hits[0]?.chunk.id).toBe('x');
});

function makeChunk(id: string, vec: number[], model: string): ChunkEmbedding {
	return {
		id,
		filePath: 'file',
		startLine: 1,
		endLine: 1,
		model,
		vector: vec,
		dim: vec.length,
		tokensEstimated: 0,
		chunkRef: {
			filePath: 'file',
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
