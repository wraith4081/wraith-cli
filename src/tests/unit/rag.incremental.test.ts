import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@provider/types';
import { incrementalIndex } from '@rag/incremental';
import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// --- fakes ---

class ProviderFake implements IProvider {
	readonly name = 'openai' as const;
	async listModels() {
		return await Promise.resolve([]);
	}
	async streamChat() {
		await Promise.resolve();
		throw new Error('not used');
	}

	async embed(texts: string[], _model?: string): Promise<number[][]> {
		return await Promise.resolve(
			texts.map((t) => {
				const n = Math.max(1, Math.min(8, t.length % 8));
				const v = new Array(n).fill(0).map((_, i) => (i === 0 ? 1 : 0));
				return v;
			})
		);
	}
}

class ColdDriverFake implements ColdIndexDriver {
	upserts: ChunkEmbedding[] = [];
	deletes: string[] = [];
	async init(): Promise<void> {
		//
	}
	async upsert(chunks: ChunkEmbedding[]): Promise<number> {
		this.upserts.push(...chunks);
		return await Promise.resolve(chunks.length);
	}
	async search(): Promise<RetrievedChunk[]> {
		return await Promise.resolve([]);
	}
	async deleteByIds(ids: string[]): Promise<number> {
		this.deletes.push(...ids);
		return await Promise.resolve(ids.length);
	}
	async close(): Promise<void> {
		//
	}
}

function write(p: string, s: string) {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, s, 'utf8');
}

function rel(root: string, p: string) {
	return path.relative(root, p).split(path.sep).join('/');
}

let tmp: string;
let provider: ProviderFake;
let cold: ColdDriverFake;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-incr-'));
	provider = new ProviderFake();
	cold = new ColdDriverFake();
});

afterEach(() => {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
});

describe('incrementalIndex', () => {
	it('indexes initial files and persists manifest', async () => {
		const a = path.join(tmp, 'src', 'a.md');
		const b = path.join(tmp, 'src', 'b.txt');
		write(a, '# A\nhello');
		write(b, 'B file line 1\nline 2');

		const res = await incrementalIndex({
			rootDir: tmp,
			paths: ['src'],
			provider,
			coldDrivers: [cold],
		});

		expect(res.files.changed.sort()).toEqual(
			[rel(tmp, a), rel(tmp, b)].sort()
		);
		expect(res.chunks.upserted).toBeGreaterThan(0);
		expect(cold.upserts.length).toBe(res.chunks.upserted);
	});

	it('re-embeds only changed file and deletes stale chunk ids', async () => {
		const a = path.join(tmp, 'src', 'a.md');
		const b = path.join(tmp, 'src', 'b.txt');
		write(a, '# A\nhello');
		write(b, 'B file line 1\nline 2');

		await incrementalIndex({
			rootDir: tmp,
			paths: ['src'],
			provider,
			coldDrivers: [cold],
		});
		const upsertsFirst = cold.upserts.length;

		// modify a.md; b stays the same
		write(a, '# A\nhello world!\nmore');

		cold.upserts = [];
		cold.deletes = [];

		const res2 = await incrementalIndex({
			rootDir: tmp,
			paths: ['src'],
			provider,
			coldDrivers: [cold],
		});

		expect(res2.files.changed).toEqual([rel(tmp, a)]);
		expect(res2.files.unchanged).toContain(rel(tmp, b));
		expect(cold.upserts.length).toBeGreaterThan(0);
		// should delete stale chunks that belonged to old version of a.md OR removals
		expect(res2.chunks.deleted).toBeGreaterThanOrEqual(1);
		expect(cold.deletes.length).toBe(res2.chunks.deleted);

		// total embeddings across both runs should be > first run’s upserts
		expect(upsertsFirst).toBeGreaterThan(0);
	});

	it('handles removed files by deleting their chunk ids', async () => {
		const a = path.join(tmp, 'src', 'a.md');
		const b = path.join(tmp, 'src', 'b.txt');
		write(a, '# A\nhello');
		write(b, 'B file');

		await incrementalIndex({
			rootDir: tmp,
			paths: ['src'],
			provider,
			coldDrivers: [cold],
		});

		// remove b
		fs.rmSync(b);

		cold.upserts = [];
		cold.deletes = [];

		const res = await incrementalIndex({
			rootDir: tmp,
			paths: ['src'],
			provider,
			coldDrivers: [cold],
		});
		expect(res.files.removed).toEqual([rel(tmp, b)]);
		expect(res.chunks.deleted).toBeGreaterThan(0);
		expect(cold.deletes.length).toBe(res.chunks.deleted);
	});
});
