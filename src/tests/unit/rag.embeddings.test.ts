import type { Chunk } from '@ingest/chunking';
import type { ChatResult, IProvider, StreamDelta } from '@provider/types';
import {
	batchEmbed,
	embedChunksForRAG,
	getEmbeddingModelFromConfig,
} from '@rag/embeddings';
import { describe, expect, it } from 'vitest';

class MockProvider implements IProvider {
	readonly name = 'openai' as const;
	calls = 0;
	failFirst = false;

	async listModels() {
		return await Promise.resolve([]);
	}

	async streamChat(
		_req: unknown,
		_onDelta: (d: StreamDelta) => void,
		_signal?: AbortSignal
	): Promise<ChatResult> {
		return await Promise.resolve({ model: 'gpt-5', content: '' });
	}

	async embed(texts: string[]): Promise<number[][]> {
		this.calls++;
		if (this.failFirst) {
			this.failFirst = false;
			throw new Error('transient');
		}
		// Deterministic vectors: [len, len+1, len+2]
		return await Promise.resolve(
			texts.map((t) => {
				const n = Buffer.byteLength(t, 'utf8');
				return [n, n + 1, n + 2];
			})
		);
	}
}

function mkChunk(
	filePath: string,
	content: string,
	start = 1,
	end?: number
): Chunk {
	return {
		filePath,
		startLine: start,
		endLine: end ?? start + content.split(/\r?\n/).length - 1,
		chunkIndex: 0,
		chunkCount: 1,
		sha256: String(Math.abs(hashCode(content))), // simple stable id for test
		content,
		tokensEstimated: Math.ceil(Buffer.byteLength(content, 'utf8') / 4),
		fileType: 'text',
	};
}

function hashCode(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) {
		h = (h * 31 + s.charCodeAt(i)) | 0;
	}
	return h;
}

describe('RAG embeddings', () => {
	it('selects embedding model from config and profile', () => {
		const cfg = {
			version: '1',
			defaults: { embeddingModel: 'text-embedding-3-large' },
			profiles: { speed: { embeddingModel: 'text-embedding-3-small' } },
		};
		expect(getEmbeddingModelFromConfig(cfg)).toBe('text-embedding-3-large');
		expect(getEmbeddingModelFromConfig(cfg, 'speed')).toBe(
			'text-embedding-3-small'
		);
		expect(getEmbeddingModelFromConfig({ version: '1' })).toBe(
			'text-embedding-3-large'
		); // fallback
	});

	it('batchEmbed preserves order and splits batches', async () => {
		const provider = new MockProvider();
		const items = Array.from({ length: 5 }, (_, i) => ({
			id: String(i + 1),
			text: `t${i + 1}`,
		}));
		const res = await batchEmbed({
			provider,
			model: 'text-embedding-3-large',
			items,
			batchSize: 2,
			sleep: async () => {
				// no delay in tests
			},
		});
		expect(res.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5']);
		expect(provider.calls).toBe(3);
	});

	it('retries on transient errors with backoff', async () => {
		const provider = new MockProvider();
		provider.failFirst = true;
		const res = await batchEmbed({
			provider,
			model: 'text-embedding-3-large',
			items: [{ id: 'a', text: 'hello' }],
			maxRetries: 2,
			sleep: async () => {
				// avoid delay
			},
		});
		expect(res.length).toBe(1);
		expect(provider.calls).toBeGreaterThanOrEqual(2);
	});

	it('embeds chunks and returns metadata with vectors', async () => {
		const provider = new MockProvider();
		const chunks: Chunk[] = [
			mkChunk('src/a.ts', 'export const x = 1;'),
			mkChunk('docs/readme.md', '# Title\n\nBody'),
		];
		const res = await embedChunksForRAG(
			provider,
			{ version: '1' },
			chunks,
			{
				modelOverride: 'text-embedding-3-large',
				batchSize: 1,
				sleep: async () => {
					// no delay in tests
				},
			}
		);
		expect(res.length).toBe(2);
		expect(res[0]?.filePath).toBe('src/a.ts');
		expect(res[0]?.vector.length).toBe(3);
		expect(res[0]?.model).toBe('text-embedding-3-large');
	});
});
