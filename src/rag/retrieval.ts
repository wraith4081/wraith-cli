import type { ColdIndexDriver, RetrievedChunk } from '@rag/types';

export interface HotIndexLike {
	search(
		queryVector: number[],
		opts?: { topK?: number; modelFilter?: string; scoreThreshold?: number }
	): Promise<RetrievedChunk[]>;
}

export interface RetrievalOptions {
	/** Total results to return after merge & dedupe (default 8) */
	topK?: number;
	/** If >= this many good hits come from hot, skip cold (default: min(4, topK)) */
	hotMin?: number;
	/** Optional filter to restrict by embedding model id/alias */
	modelFilter?: string;
	/** Drop hits with score below this threshold (default: undefined) */
	scoreThreshold?: number;
	/** Dedupe policy: by exact chunk id or by file span (default 'span') */
	dedupeBy?: 'id' | 'span';
	/** Prefer hot results on equal score during dedupe (default true) */
	preferHotOnTie?: boolean;
	/** Query colds sequentially (default) or in parallel */
	coldCascade?: 'sequential' | 'parallel';
	/** Limit number of citations returned (default = final hits length) */
	maxCitations?: number;
}

export interface RetrievalResult {
	hits: RetrievedChunk[]; // sorted by score desc
	used: { fromHot: number; fromCold: number };
	queried: { hot: boolean; coldDrivers: number };
	/** Simple "filePath:start-end (via source)" lines */
	citations: string[];
}

function keyOf(
	h: RetrievedChunk,
	mode: 'id' | 'span'
): { key: string; file: string; start: number; end: number } {
	const c = h.chunk;
	if (mode === 'id') {
		return {
			key: c.id,
			file: c.filePath,
			start: c.startLine,
			end: c.endLine,
		};
	}
	return {
		key: `${c.filePath}:${c.startLine}-${c.endLine}`,
		file: c.filePath,
		start: c.startLine,
		end: c.endLine,
	};
}

function scoreOf(h: RetrievedChunk): number {
	return typeof h.score === 'number' && Number.isFinite(h.score)
		? h.score
		: 0;
}

function mergeAndDedupe(
	hotHits: RetrievedChunk[],
	coldHits: RetrievedChunk[],
	opts: Required<
		Pick<RetrievalOptions, 'dedupeBy' | 'preferHotOnTie' | 'topK'>
	>
): RetrievedChunk[] {
	const out = new Map<string, { hit: RetrievedChunk; via: 'hot' | 'cold' }>();

	// Insert helper that respects score/tie policy
	const insert = (h: RetrievedChunk, via: 'hot' | 'cold') => {
		const k = keyOf(h, opts.dedupeBy).key;
		const existing = out.get(k);
		if (!existing) {
			out.set(k, { hit: h, via });
			return;
		}
		const sNew = scoreOf(h);
		const sOld = scoreOf(existing.hit);
		if (sNew > sOld) {
			out.set(k, { hit: h, via });
		} else if (
			sNew === sOld &&
			opts.preferHotOnTie &&
			existing.via === 'cold' &&
			via === 'hot'
		) {
			// Prefer hot when tie and new is hot replacing cold
			out.set(k, { hit: h, via });
		}
	};

	for (const h of hotHits) {
		insert(h, 'hot');
	}
	for (const h of coldHits) {
		insert(h, 'cold');
	}

	// Sort by score desc; on tie, prefer hot
	const all = Array.from(out.values());
	all.sort((a, b) => {
		const d = scoreOf(b.hit) - scoreOf(a.hit);
		if (d !== 0) {
			return d;
		}
		if (a.via === b.via) {
			return 0;
		}
		return a.via === 'hot' ? -1 : 1;
	});

	return all.slice(0, opts.topK).map((r) => r.hit);
}

function buildViaMap(
	hotHits: RetrievedChunk[],
	coldHits: RetrievedChunk[],
	mode: 'id' | 'span'
): Map<string, 'hot' | 'cold'> {
	const m = new Map<string, 'hot' | 'cold'>();
	for (const h of hotHits) {
		m.set(keyOf(h, mode).key, 'hot');
	}
	for (const h of coldHits) {
		const k = keyOf(h, mode).key;
		if (!m.has(k)) {
			m.set(k, 'cold');
		}
	}
	return m;
}

function buildCitations(
	hits: RetrievedChunk[],
	via: Map<string, 'hot' | 'cold'>,
	mode: 'id' | 'span',
	max?: number
): string[] {
	const lines: string[] = [];
	for (const h of hits.slice(
		0,
		typeof max === 'number' ? max : hits.length
	)) {
		const { file, start, end, key } = keyOf(h, mode);
		const source = via.get(key) ?? 'cold';
		lines.push(`${file}:${start}-${end} (via ${source})`);
	}
	return lines;
}

export async function retrieveSimilar(
	queryVector: number[],
	deps: {
		hot?: HotIndexLike;
		colds?: ColdIndexDriver[];
	},
	opts: RetrievalOptions = {}
): Promise<RetrievalResult> {
	const topK = Math.max(1, opts.topK ?? 8);
	const hotMin = Math.max(0, opts.hotMin ?? Math.min(4, topK));
	const scoreThreshold = opts.scoreThreshold;
	const modelFilter = opts.modelFilter;
	const dedupeBy = opts.dedupeBy ?? 'span';
	const preferHotOnTie = opts.preferHotOnTie ?? true;
	const coldCascade = opts.coldCascade ?? 'sequential';

	// 1) Hot search
	let hotHits: RetrievedChunk[] = [];
	let hotQueried = false;
	if (deps.hot) {
		hotQueried = true;
		hotHits = await deps.hot.search(queryVector, {
			topK,
			modelFilter,
			scoreThreshold,
		});
	}

	// Filter hot locally to avoid relying on driver behavior
	const hotKept =
		typeof scoreThreshold === 'number'
			? hotHits.filter((h) => scoreOf(h) >= scoreThreshold)
			: hotHits;

	if (hotKept.length >= Math.min(hotMin, topK) || topK <= hotKept.length) {
		// early exit if hot is enough
		const via = buildViaMap(hotKept, [], dedupeBy);
		const finalHits = mergeAndDedupe(hotKept, [], {
			dedupeBy,
			preferHotOnTie,
			topK,
		});
		return {
			hits: finalHits,
			used: { fromHot: finalHits.length, fromCold: 0 },
			queried: { hot: hotQueried, coldDrivers: 0 },
			citations: buildCitations(
				finalHits,
				via,
				dedupeBy,
				opts.maxCitations
			),
		};
	}

	// 2) Cold search if needed
	const remaining = Math.max(0, topK - hotKept.length);
	const colds = deps.colds ?? [];
	const coldHits: RetrievedChunk[] = [];

	if (colds.length > 0 && remaining > 0) {
		if (coldCascade === 'parallel') {
			const all = await Promise.all(
				colds.map((d) =>
					d.search(queryVector, { topK, modelFilter, scoreThreshold })
				)
			);
			for (const arr of all) {
				coldHits.push(...arr);
			}
		} else {
			for (const d of colds) {
				const batch = await d.search(queryVector, {
					topK: remaining,
					modelFilter,
					scoreThreshold,
				});
				coldHits.push(...batch);
				if (coldHits.length >= remaining) {
					break;
				}
			}
		}
	}

	const coldKept =
		typeof scoreThreshold === 'number'
			? coldHits.filter((h) => scoreOf(h) >= scoreThreshold)
			: coldHits;

	// 3) Merge & dedupe
	const via = buildViaMap(hotKept, coldKept, dedupeBy);
	const finalHits = mergeAndDedupe(hotKept, coldKept, {
		dedupeBy,
		preferHotOnTie,
		topK,
	});

	const fromHot = finalHits.filter(
		(h) => (via.get(keyOf(h, dedupeBy).key) ?? 'cold') === 'hot'
	).length;

	return {
		hits: finalHits,
		used: { fromHot, fromCold: finalHits.length - fromHot },
		queried: { hot: hotQueried, coldDrivers: colds.length },
		citations: buildCitations(finalHits, via, dedupeBy, opts.maxCitations),
	};
}
