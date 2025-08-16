import { type PgDistance, PgVectorDriver } from '@rag/drivers/pgvector';
import type { ChunkEmbedding, RetrievedChunk } from '@rag/types';
import { beforeEach, describe, expect, it } from 'vitest';

// --- Tiny in-memory PG mock ---
type Row = {
	id: string;
	vector: number[];
	model: string;
	filePath: string;
	startLine: number;
	endLine: number;
	dim: number;
	tokensEstimated: number;
};

class FakePg {
	rows = new Map<string, Row>();
	distance: PgDistance;

	constructor(distance: PgDistance) {
		this.distance = distance;
	}

	query(text: string, params: unknown[] = []) {
		const sql = squish(text);

		// Probes
		if (/information_schema\.tables/i.test(sql)) {
			return { rows: [] as unknown[] as Record<string, unknown>[] };
		}

		// CREATE EXTENSION/SCHEMA/TABLE/INDEX — accept silently
		if (
			/^create extension/i.test(sql) ||
			/^create schema/i.test(sql) ||
			/^create table/i.test(sql) ||
			/^create index/i.test(sql)
		) {
			return { rows: [] as unknown[] as Record<string, unknown>[] };
		}

		// INSERT ... ON CONFLICT (id) DO UPDATE
		if (/^insert into/i.test(sql)) {
			const chunks = chunk(params, 8);
			for (const vals of chunks) {
				const [
					id,
					vecTxt,
					model,
					filePath,
					startLine,
					endLine,
					dim,
					tok,
				] = vals;
				const v = parseVecText(String(vecTxt));
				const row: Row = {
					id: String(id),
					vector: v,
					model: String(model),
					filePath: String(filePath),
					startLine: Number(startLine),
					endLine: Number(endLine),
					dim: Number(dim),
					tokensEstimated: Number(tok),
				};
				this.rows.set(row.id, row);
			}
			return { rows: [] as unknown[] as Record<string, unknown>[] };
		}

		// DELETE
		if (/^delete from/i.test(sql)) {
			const ids: string[] = (params[0] as string[]) ?? [];
			for (const id of ids) {
				this.rows.delete(String(id));
			}
			return { rows: [] as unknown[] as Record<string, unknown>[] };
		}

		// SELECT ... ORDER BY d LIMIT
		if (/^select/i.test(sql)) {
			const vecTxt = params[0] as string;
			const qv = parseVecText(vecTxt);
			let modelFilter: string | undefined;
			let limit = 10;
			if (/where model = \$2/i.test(sql)) {
				modelFilter = String(params[1]);
				limit = Number(params[2] ?? 10);
			} else {
				limit = Number(params[1] ?? 10);
			}

			const scored = Array.from(this.rows.values())
				.filter((r) => (modelFilter ? r.model === modelFilter : true))
				.map((r) => ({ r, d: this.distanceOf(r.vector, qv) }))
				.sort((a, b) => a.d - b.d)
				.slice(0, limit)
				.map(({ r, d }) => ({
					id: r.id,
					model: r.model,
					filePath: r.filePath,
					startLine: r.startLine,
					endLine: r.endLine,
					dim: r.dim,
					tokensEstimated: r.tokensEstimated,
					vector: r.vector,
					d,
				}));

			return {
				rows: scored as unknown as Record<string, unknown>[],
			};
		}

		throw new Error(`Unrecognized SQL in fake PG:\n${sql}`);
	}

	private distanceOf(a: number[], b: number[]): number {
		switch (this.distance) {
			case 'cosine': {
				return cosineDist(a, b);
			}
			case 'ip': {
				return -dot(a, b);
			}
			default: {
				return l2(a, b);
			}
		}
	}
}

function squish(s: string) {
	return s.replace(/\s+/g, ' ').trim();
}
function chunk<T>(arr: T[], n: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += n) {
		out.push(arr.slice(i, i + n));
	}
	return out;
}
function parseVecText(v: string): number[] {
	const s = v.trim().replace(/^\[/, '').replace(/\]$/, '');
	if (!s) {
		return [];
	}
	return s.split(',').map((t) => Number(t.trim()));
}
function dot(a: number[], b: number[]) {
	let s = 0;
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		s += (a[i] ?? 0) * (b[i] ?? 0);
	}
	return s;
}
function norm(a: number[]) {
	return Math.sqrt(dot(a, a)) || 1e-12;
}
function cosineDist(a: number[], b: number[]) {
	return 1 - dot(a, b) / (norm(a) * norm(b));
}
function l2(a: number[], b: number[]) {
	let s = 0;
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const d = (a[i] ?? 0) - (b[i] ?? 0);
		s += d * d;
	}
	return Math.sqrt(s);
}

function makeChunk(
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

// --- Tests ---
describe('PgVectorDriver (mocked pg)', () => {
	let connectImpl: (d: PgDistance) => () => Promise<FakePg>;

	beforeEach(() => {
		connectImpl = (d: PgDistance) => async () => new FakePg(d);
	});

	it('creates table on first upsert and returns nearest neighbors (cosine)', async () => {
		const driver = new PgVectorDriver({
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			connectImpl: connectImpl('cosine') as any,
			distance: 'cosine',
		});

		await driver.upsert([
			makeChunk('a', [1, 0, 0]),
			makeChunk('b', [0.9, 0.1, 0]),
		]);

		const hits = await driver.search([1, 0, 0], { topK: 1 });
		expect(hits.length).toBe(1);
		expect(hits[0].chunk.id).toBe('a');
		expect((hits[0].score ?? 0) > 0.99).toBeTruthy();
	});

	it('respects model filter and scoreThreshold (l2)', async () => {
		const driver = new PgVectorDriver({
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			connectImpl: connectImpl('l2') as any,
			distance: 'l2',
		});

		await driver.upsert([
			makeChunk('mA', [1, 0], 'A'),
			makeChunk('mB', [1, 0], 'B'),
			makeChunk('far', [0, 1], 'A'),
		]);

		const hits = await driver.search([1, 0], {
			modelFilter: 'A',
			topK: 10,
			scoreThreshold: 0.7,
		});
		const ids = hits.map((h: RetrievedChunk) => h.chunk.id);
		expect(ids).toContain('mA');
		expect(ids).not.toContain('mB');
		expect(ids).not.toContain('far');
	});

	it('upsert replaces existing id and deleteByIds removes points (ip)', async () => {
		const driver = new PgVectorDriver({
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			connectImpl: connectImpl('ip') as any,
			distance: 'ip',
		});

		await driver.upsert([makeChunk('x', [0, 1], 'M')]);
		await driver.upsert([makeChunk('x', [1, 0], 'M')]);

		const top = await driver.search([1, 0], { topK: 1 });
		expect(top[0].chunk.id).toBe('x');

		const n = await driver.deleteByIds(['x']);
		expect(n).toBe(1);

		const after = await driver.search([1, 0], { topK: 1 });
		expect(after.length).toBe(0);
	});
});
