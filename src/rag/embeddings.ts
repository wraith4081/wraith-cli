import type { Chunk } from '@ingest/chunking';
import type { IProvider } from '@provider/types';
import { ConfigV1Z } from '@store/schema';
import type {
	ChunkEmbedding,
	EmbeddingRequestItem,
	EmbeddingResultItem,
} from './types';

function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getEmbeddingModelFromConfig(
	cfgUnknown: unknown,
	profileName?: string
): string {
	const parsed = ConfigV1Z.safeParse(cfgUnknown);
	if (!parsed.success) {
		return 'text-embedding-3-large';
	}
	const cfg = parsed.data;
	const profileModel = profileName
		? cfg.profiles?.[profileName]?.embeddingModel
		: undefined;
	return (
		profileModel || cfg.defaults?.embeddingModel || 'text-embedding-3-large'
	);
}

export interface BatchEmbedOptions {
	provider: IProvider;
	model: string;
	items: EmbeddingRequestItem[];
	batchSize?: number;
	maxRetries?: number;
	backoffBaseMs?: number;
	jitter?: boolean;
	sleep?: (ms: number) => Promise<void>;
}

export async function batchEmbed(
	opts: BatchEmbedOptions
): Promise<EmbeddingResultItem[]> {
	const {
		provider,
		model,
		items,
		batchSize = 64,
		maxRetries = 2,
		backoffBaseMs = 200,
		jitter = true,
		sleep = defaultSleep,
	} = opts;

	const out: EmbeddingResultItem[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const slice = items.slice(i, i + batchSize);

		let attempt = 0;
		// Simple retry loop
		// eslint-disable-next-line no-constant-condition
		while (true) {
			try {
				const vectors = await provider.embed(
					slice.map((s) => s.text),
					model
				);
				for (let j = 0; j < vectors.length; j++) {
					const vec = vectors[j];
					out.push({
						id: slice[j].id,
						vector: vec,
						dim: vec.length,
					});
				}
				break; // batch successful
			} catch (err) {
				attempt++;
				if (attempt > maxRetries) {
					throw err;
				}
				const delay =
					backoffBaseMs * 2 ** (attempt - 1) +
					(jitter ? Math.floor(Math.random() * backoffBaseMs) : 0);
				await sleep(delay);
			}
		}
	}

	return out;
}

export interface EmbedChunksOptions {
	profileName?: string; // select profile-scoped embeddingModel
	modelOverride?: string; // force a specific embedding model
	batchSize?: number;
	maxRetries?: number;
	backoffBaseMs?: number;
	jitter?: boolean;
	sleep?: (ms: number) => Promise<void>;
}

export async function embedChunksForRAG(
	provider: IProvider,
	cfgUnknown: unknown,
	chunks: Chunk[],
	opts: EmbedChunksOptions = {}
): Promise<ChunkEmbedding[]> {
	if (chunks.length === 0) {
		return [];
	}

	const model =
		opts.modelOverride ??
		getEmbeddingModelFromConfig(cfgUnknown, opts.profileName);

	const items: EmbeddingRequestItem[] = chunks.map((c) => ({
		id: c.sha256,
		text: c.content,
	}));

	const results = await batchEmbed({
		provider,
		model,
		items,
		batchSize: opts.batchSize,
		maxRetries: opts.maxRetries,
		backoffBaseMs: opts.backoffBaseMs,
		jitter: opts.jitter,
		sleep: opts.sleep,
	});

	// Map results by id to be explicit (though order is preserved)
	const byId = new Map<string, EmbeddingResultItem>();
	for (const r of results) {
		byId.set(r.id, r);
	}

	const out: ChunkEmbedding[] = [];
	for (const chunk of chunks) {
		const r = byId.get(chunk.sha256);
		if (!r) {
			continue; // should not happen
		}
		out.push({
			id: chunk.sha256,
			filePath: chunk.filePath,
			startLine: chunk.startLine,
			endLine: chunk.endLine,
			model,
			vector: r.vector,
			dim: r.dim,
			tokensEstimated: chunk.tokensEstimated,
			chunkRef: chunk,
		});
	}
	return out;
}
