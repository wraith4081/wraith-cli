import fs from 'node:fs';
import path from 'node:path';
import { HotIndex } from '@rag/hot-index';
import { type RetrievalOptions, retrieveSimilar } from '@rag/retrieval';
import type { ColdIndexDriver, RetrievedChunk } from '@rag/types';
import { hotIndexDir } from '@util/paths';

interface UsageV1 {
	version: 1;
	counts: Record<string, number>;
	lastAccess: Record<string, number>;
}

export interface PromotionOptions extends RetrievalOptions {
	/** Promote when a chunk id reaches this usage count (default 3) */
	promoteThreshold?: number;
	/** Hot index capacity (passed to HotIndex) */
	hotCapacity?: number;
	/** Usage store file directory (defaults to hotIndexDir) */
	baseDir?: string;
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function loadUsage(file: string): UsageV1 {
	if (!fs.existsSync(file)) {
		return { version: 1, counts: {}, lastAccess: {} };
	}
	try {
		const raw = fs.readFileSync(file, 'utf8');
		const p = JSON.parse(raw) as UsageV1;
		if (p?.version !== 1) {
			return { version: 1, counts: {}, lastAccess: {} };
		}
		return {
			version: 1,
			counts: p.counts ?? {},
			lastAccess: p.lastAccess ?? {},
		};
	} catch {
		return { version: 1, counts: {}, lastAccess: {} };
	}
}

function saveUsage(file: string, u: UsageV1): void {
	ensureDir(path.dirname(file)); // ✅ make sure the dir exists
	const s = JSON.stringify(u, null, 2);
	fs.writeFileSync(file, s, 'utf8');
	try {
		if (process.platform !== 'win32') {
			fs.chmodSync(file, 0o600);
		}
	} catch {
		// ignore
	}
}

export async function retrieveWithPromotion(
	queryVector: number[],
	deps: { hot?: HotIndex; colds?: ColdIndexDriver[] },
	opts: PromotionOptions = {}
) {
	// Prefer an explicit baseDir, then the provided HotIndex's baseDir, then default.
	const base =
		opts.baseDir ??
		(deps.hot && typeof deps.hot.getBaseDir === 'function'
			? deps.hot.getBaseDir()
			: hotIndexDir);

	ensureDir(base);
	const usageFile = path.join(base, 'usage.v1.json');
	const usage = loadUsage(usageFile);
	const threshold = Math.max(1, opts.promoteThreshold ?? 3);

	const hot =
		deps.hot ??
		new HotIndex({
			baseDir: base,
			capacity: Math.max(1, opts.hotCapacity ?? 1000),
		});

	const res = await retrieveSimilar(
		queryVector,
		{ hot, colds: deps.colds },
		opts
	);

	const ids = res.hits.map((h) => h.chunk.id);
	const now = Date.now();
	for (const id of ids) {
		usage.counts[id] = (usage.counts[id] ?? 0) + 1;
		usage.lastAccess[id] = now;
	}
	saveUsage(usageFile, usage);

	const toPromote: RetrievedChunk[] = [];
	for (const h of res.hits) {
		const id = h.chunk.id;
		const count = usage.counts[id] ?? 0;
		const isInHot = hot.has(id);
		const cameFromHot = h.source === 'hot';
		if (!(cameFromHot || isInHot) && count >= threshold) {
			toPromote.push(h);
		}
	}
	if (toPromote.length > 0) {
		await hot.upsert(toPromote.map((h) => h.chunk));
	}

	return res;
}
