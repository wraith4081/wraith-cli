import type {
	ChunkEmbedding,
	ColdIndexDriver,
	RetrievedChunk,
} from '@rag/types';
import { coldIndexDir } from '@util/paths';

type QdrantClientFactory = (opts: {
	url: string;
	apiKey?: string;
}) => Promise<QdrantClientLike>;

interface QdrantClientLike {
	collections: {
		get(name: string): Promise<{ result?: unknown }>;
		create(name: string, payload: unknown): Promise<unknown>;
	};
	points: {
		upsert(name: string, payload: unknown): Promise<{ result?: unknown }>;
		search(name: string, payload: unknown): Promise<{ result: unknown[] }>;
		delete(name: string, payload: unknown): Promise<{ result?: unknown }>;
	};
}

export interface QdrantDriverOptions {
	/**
	 * Qdrant base URL, e.g. http://localhost:6333 or https://cluster-xxx.qdrant.io
	 * Defaults to local dev at 6333.
	 */
	url?: string;
	/** API key if your instance enforces auth */
	apiKey?: string;
	/** Collection name; created on demand if missing */
	collection?: string;
	/** Vector distance; Qdrant supports "Cosine" | "Dot" | "Euclid" */
	distance?: 'Cosine' | 'Dot' | 'Euclid';
	/**
	 * Expected vector dimension. If not provided, we infer from first upsert().
	 * (Search before the first upsert will no-op if collection doesn't exist.)
	 */
	dim?: number;
	/** Internal: injectable client ctor for tests */
	connectImpl?: QdrantClientFactory;
}

const DEFAULTS = {
	url: 'http://localhost:6333',
	collection: 'wraith_chunks',
	distance: 'Cosine' as const,
};

function buildModelFilter(model?: string) {
	if (!model) {
		return;
	}
	return { must: [{ key: 'model', match: { value: model } }] };
}

export class QdrantDriver implements ColdIndexDriver {
	private opts: QdrantDriverOptions;
	private client?: QdrantClientLike;
	private haveCollection = false;

	constructor(opts: QdrantDriverOptions = {}) {
		this.opts = { ...DEFAULTS, ...opts };
		// Just touching coldIndexDir ensures parent exists in repo structure;
		// Qdrant is remote, so we don't write here, but it's handy for parity/logs.
		coldIndexDir;
	}

	async init(): Promise<void> {
		if (!this.client) {
			const mk = this.opts.connectImpl ?? (await this.lazyLoadClient());
			this.client = await mk({
				url: this.opts.url ?? 'http://localhost:6333',
				apiKey: this.opts.apiKey,
			});
		}

		// Probe collection existence once; we may also create lazily during first upsert
		try {
			await this.client.collections.get(this.opts.collection ?? '');
			this.haveCollection = true;
		} catch {
			this.haveCollection = false;
		}
	}

	async upsert(chunks: ChunkEmbedding[]): Promise<number> {
		if (chunks.length === 0) {
			return 0;
		}
		await this.init();

		if (!this.haveCollection) {
			const dim =
				this.opts.dim ?? chunks[0].dim ?? chunks[0].vector.length;
			await this.ensureCollection(dim);
		}

		const points = chunks.map((c) => ({
			id: c.id, // string ids are fine
			vector: c.vector,
			payload: {
				model: c.model,
				filePath: c.filePath,
				startLine: c.startLine,
				endLine: c.endLine,
				dim: c.dim,
				tokensEstimated: c.tokensEstimated,
			},
		}));

		await this.client?.points.upsert(this.opts.collection ?? '', {
			wait: true,
			points,
		});

		return points.length;
	}

	async search(
		queryVector: number[],
		opts: {
			topK?: number;
			modelFilter?: string;
			scoreThreshold?: number;
		} = {}
	): Promise<RetrievedChunk[]> {
		await this.init();
		if (!this.haveCollection) {
			// no collection => nothing to return
			return [];
		}

		const limit = Math.max(1, opts.topK ?? 8);
		const filter = buildModelFilter(opts.modelFilter);

		const res = await this.client?.points.search(
			this.opts.collection ?? '',
			{
				vector: queryVector,
				with_payload: true,
				with_vector: true,
				limit,
				filter,
			}
		);

		const out: RetrievedChunk[] = [];
		for (const r of (res?.result ?? []) as {
			id: string;
			payload: Record<string, unknown>;
			vector: number[];
			score: number;
		}[]) {
			const id = String(r?.id);
			const payload = (r?.payload ?? {}) as Record<string, unknown>;
			const vector: number[] = Array.isArray(r.vector)
				? (r.vector as number[])
				: [];
			const score: number | undefined =
				typeof r?.score === 'number' ? (r.score as number) : undefined;

			const filePath = String(payload.filePath ?? '');
			const startLine = Number(payload.startLine ?? 1);
			const endLine = Number(payload.endLine ?? 1);
			const model = String(payload.model ?? '');
			const dim = Number(payload.dim ?? vector.length ?? 0);
			const tokensEstimated = Number(payload.tokensEstimated ?? 0);

			if (
				typeof opts.scoreThreshold === 'number' &&
				(score ?? 0) < opts.scoreThreshold
			) {
				continue;
			}

			out.push({
				score: Number(score),
				chunk: {
					id,
					filePath,
					startLine,
					endLine,
					model,
					vector,
					dim,
					tokensEstimated,
					chunkRef: {
						filePath,
						startLine,
						endLine,
						chunkIndex: 0,
						chunkCount: 0,
						sha256: id,
						content: '',
						tokensEstimated,
						fileType: 'text',
					},
				} as ChunkEmbedding,
				source: 'qdrant',
			});
		}
		return out;
	}

	async deleteByIds(ids: string[]): Promise<number> {
		if (!ids?.length) {
			return 0;
		}
		await this.init();
		if (!this.haveCollection) {
			return 0;
		}

		await this.client?.points.delete(this.opts.collection ?? '', {
			points: ids,
			wait: true,
		});
		return ids.length;
	}

	async close(): Promise<void> {
		// REST client is stateless; nothing to close explicitly.
	}

	private async ensureCollection(dim: number) {
		try {
			await this.client?.collections.create(this.opts.collection ?? '', {
				vectors: {
					size: dim,
					distance: this.opts.distance ?? 'Cosine',
				},
			});
			this.haveCollection = true;
		} catch {
			// If a race created it meanwhile, mark as available and continue
			this.haveCollection = true;
		}
	}

	private async lazyLoadClient(): Promise<QdrantClientFactory> {
		// dynamic import to avoid pulling the client unless needed
		const mod = (await import('@qdrant/js-client-rest')) as unknown as {
			QdrantClient: new (args: {
				url: string;
				apiKey?: string;
			}) => QdrantClientLike;
		};
		return async ({ url, apiKey }) => new mod.QdrantClient({ url, apiKey });
	}
}
