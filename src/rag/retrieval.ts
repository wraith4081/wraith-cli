import { type HotIndex, loadHotIndex } from './hot-index';
import type { ChunkEmbedding } from './types';

export interface RetrievedChunk {
	id: string;
	score: number; // cosine similarity
	source: 'hot' | string; // cold driver name when not hot
	chunk: ChunkEmbedding;
}

export interface ColdIndexDriver {
	/** human-readable name for logs and `source` */
	name: string;
	/** upsert chunk embeddings into the collection/index */
	upsert(items: ChunkEmbedding[]): Promise<void>;
	/**
	 * vector search; must return the full ChunkEmbedding for promotion/attribution.
	 * `filter.model` is a simple equality filter for v1; drivers may ignore it.
	 */
	queryByVector(
		vector: number[],
		opts: { topK: number; filter?: { model?: string } }
	): Promise<Array<{ score: number; chunk: ChunkEmbedding }>>;
}

export interface RetrieveOptions {
	hot?: HotIndex;
	colds?: ColdIndexDriver[];
	topKHot?: number; // how many to try from hot before going cold
	topK?: number; // final topK after merge/dedupe
	minResults?: number; // if hot < minResults, query colds
	scoreThreshold?: number; // drop below this similarity after merge
	modelFilter?: string; // only consider vectors from this embedding model
	promoteFromCold?: boolean; // add cold hits into hot
}

export interface RetrieveResult {
	items: RetrievedChunk[];
	fromHot: number;
	fromCold: number;
}

/** Merge by id, keep highest score, stable-prefer hot over cold when tied */
function mergeDedupe(
	hot: Array<{ score: number; chunk: ChunkEmbedding }>,
	cold: Array<{ score: number; chunk: ChunkEmbedding }>,
	modelFilter?: string
): Map<
	string,
	{ score: number; chunk: ChunkEmbedding; source: 'hot' | 'cold' }
> {
	const m = new Map<
		string,
		{ score: number; chunk: ChunkEmbedding; source: 'hot' | 'cold' }
	>();
	for (const h of hot) {
		if (modelFilter && h.chunk.model !== modelFilter) {
			continue;
		}
		const prev = m.get(h.chunk.id);
		if (!prev || h.score > prev.score) {
			m.set(h.chunk.id, { ...h, source: 'hot' });
		}
	}
	for (const c of cold) {
		if (modelFilter && c.chunk.model !== modelFilter) {
			continue;
		}
		const prev = m.get(c.chunk.id);
		if (!prev || c.score > prev.score) {
			m.set(c.chunk.id, { ...c, source: 'cold' });
		}
	}
	return m;
}

export async function retrieveByEmbedding(
	vector: number[],
	opts: RetrieveOptions = {}
): Promise<RetrieveResult> {
	const {
		topKHot = 16,
		topK = 12,
		minResults = 6,
		scoreThreshold = Number.NEGATIVE_INFINITY,
		modelFilter,
		promoteFromCold = true,
	} = opts;

	const hot = opts.hot ?? loadHotIndex();
	const hotHitsRaw = hot.query({
		vector,
		topK: topKHot,
		modelFilter,
	});

	const hotHits = hotHitsRaw.map(({ score, item }) => ({
		score,
		chunk: {
			id: item.id,
			filePath: item.filePath,
			startLine: item.startLine,
			endLine: item.endLine,
			model: item.model,
			vector: item.vector,
			dim: item.dim,
			tokensEstimated: item.tokensEstimated,
			// Minimal provenance for retrieval; chunkRef can be rehydrated by caller if needed
			chunkRef: {
				filePath: item.filePath,
				startLine: item.startLine,
				endLine: item.endLine,
				chunkIndex: 0,
				chunkCount: 0,
				sha256: item.id,
				content: '', // not needed here
				tokensEstimated: item.tokensEstimated,
				fileType: 'text',
			},
		} as ChunkEmbedding,
	}));

	let coldHits: Array<{ score: number; chunk: ChunkEmbedding }> = [];
	if (hotHits.length < minResults && (opts.colds?.length ?? 0) > 0) {
		// Query all colds in parallel; in v1 we simply concatenate and later dedupe.
		const coldBatches = await Promise.all(
			(opts.colds ?? []).map((d) =>
				d
					.queryByVector(vector, {
						topK: Math.max(topK, minResults),
						filter: { model: modelFilter },
					})
					.then((items) =>
						items.map((it) => ({ ...it, _driver: d.name }))
					)
			)
		);
		coldHits = coldBatches
			.flat()
			.map(({ score, chunk }) => ({ score, chunk }));
	}

	const merged = mergeDedupe(hotHits, coldHits, modelFilter);
	const mergedArr = Array.from(merged.values())
		.map(({ score, chunk, source }) => ({
			id: chunk.id,
			score,
			source: source === 'hot' ? 'hot' : (source as string),
			chunk,
		}))
		.filter((r) => r.score >= scoreThreshold)
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);

	// Promotion: bring cold winners into hot to speed future queries
	if (promoteFromCold) {
		const toPromote = mergedArr
			.filter((r) => r.source !== 'hot')
			.map((r) => r.chunk);
		if (toPromote.length) {
			hot.upsert(toPromote);
		}
	}

	const fromHot = mergedArr.filter((r) => r.source === 'hot').length;
	const fromCold = mergedArr.length - fromHot;

	return { items: mergedArr, fromHot, fromCold };
}
