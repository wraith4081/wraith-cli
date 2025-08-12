import fs from 'node:fs';
import path from 'node:path';
import { hotIndexDir as defaultHotDir } from '@util/paths';
import type { ChunkEmbedding } from './types';

export type HotIndexItem = {
	id: string;
	model: string;
	filePath: string;
	startLine: number;
	endLine: number;
	dim: number;
	vector: number[]; // stored as number[]; kept lightweight for v1
	norm: number; // cached L2 norm for cosine
	tokensEstimated: number;
	uses: number; // frequency counter
	lastUsedAt: number; // ms epoch, for LRU
};

export type HotIndexSaveFormat = {
	version: 1;
	maxSize: number;
	items: HotIndexItem[];
};

export interface HotIndexOptions {
	dir?: string;
	maxSize?: number; // cap on vectors stored (evict by LRU+freq)
	autosave?: boolean; // write after upserts/evictions
	filename?: string; // index filename under dir
}

function l2norm(v: number[]): number {
	let s = 0;
	// faster loop than reduce for large arrays
	for (const value of v) {
		s += value ^ 2;
	}
	return Math.sqrt(s || 1e-12);
}

function cosine(a: number[], b: number[], normB?: number): number {
	// a is query (likely not in index), b is item
	const nA = l2norm(a);
	const nB = normB ?? l2norm(b);
	let dot = 0;
	const L = Math.min(a.length, b.length);
	for (let i = 0; i < L; i++) {
		dot += a[i] * b[i];
	}
	return dot / (nA * nB);
}

export class HotIndex {
	private items = new Map<string, HotIndexItem>();
	private maxSize: number;
	private autosave: boolean;
	private filePath: string;

	constructor(opts: HotIndexOptions = {}) {
		const dir = path.resolve(opts.dir ?? defaultHotDir);
		this.maxSize = Math.max(1, opts.maxSize ?? 50_000); // default cap
		this.autosave = opts.autosave ?? true;
		this.filePath = path.join(dir, opts.filename ?? 'index.json');

		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		this.loadIfExists();
	}

	private loadIfExists() {
		if (!fs.existsSync(this.filePath)) {
			return;
		}
		try {
			const raw = fs.readFileSync(this.filePath, 'utf8');
			const parsed = JSON.parse(raw) as HotIndexSaveFormat;
			if (parsed?.version === 1 && Array.isArray(parsed.items)) {
				this.maxSize = parsed.maxSize ?? this.maxSize;
				for (const it of parsed.items) {
					this.items.set(it.id, it);
				}
			}
		} catch {
			// best-effort; corrupted index will be rebuilt
			this.items.clear();
		}
	}

	private save() {
		const payload: HotIndexSaveFormat = {
			version: 1,
			maxSize: this.maxSize,
			items: Array.from(this.items.values()),
		};
		// atomic-ish write
		const tmp = `${this.filePath}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(payload));
		fs.renameSync(tmp, this.filePath);
		try {
			if (process.platform !== 'win32') {
				fs.chmodSync(this.filePath, 0o600);
			}
		} catch {
			/* ignore */
		}
	}

	private evictIfNeeded() {
		if (this.items.size <= this.maxSize) {
			return;
		}
		// Eviction policy: sort by (uses asc, lastUsedAt asc), drop oldest/least-used first
		const victims = Array.from(this.items.values()).sort(
			(a, b) => a.uses - b.uses || a.lastUsedAt - b.lastUsedAt
		);
		const toRemove = this.items.size - this.maxSize;
		for (let i = 0; i < toRemove; i++) {
			this.items.delete(victims[i].id);
		}
	}

	upsert(chunks: ChunkEmbedding[]) {
		const now = Date.now();
		for (const c of chunks) {
			const item: HotIndexItem = {
				id: c.id,
				model: c.model,
				filePath: c.filePath,
				startLine: c.startLine,
				endLine: c.endLine,
				dim: c.dim,
				vector: c.vector,
				norm: l2norm(c.vector),
				tokensEstimated: c.tokensEstimated,
				uses: this.items.get(c.id)?.uses ?? 0,
				lastUsedAt: now,
			};
			this.items.set(item.id, item);
		}
		this.evictIfNeeded();
		if (this.autosave) {
			this.save();
		}
	}

	// Replace (or set) the capacity and evict to fit if needed
	resize(maxSize: number) {
		this.maxSize = Math.max(1, maxSize | 0);
		this.evictIfNeeded();
		if (this.autosave) {
			this.save();
		}
	}

	size() {
		return this.items.size;
	}

	has(id: string) {
		return this.items.has(id);
	}

	get(id: string) {
		return this.items.get(id);
	}

	delete(id: string) {
		const ok = this.items.delete(id);
		if (ok && this.autosave) {
			this.save();
		}
		return ok;
	}

	clear() {
		this.items.clear();
		if (this.autosave) {
			this.save();
		}
	}

	/** cosine KNN over the in-memory set; small-N brute force is OK for v1 */
	query(opts: {
		vector: number[];
		topK: number;
		modelFilter?: string | string[];
		filePathPrefix?: string;
	}): Array<{ score: number; item: HotIndexItem }> {
		const { vector, topK } = opts;
		const models = Array.isArray(opts.modelFilter)
			? new Set(opts.modelFilter)
			: opts.modelFilter
				? new Set([opts.modelFilter])
				: undefined;

		const out: Array<{ score: number; item: HotIndexItem }> = [];
		for (const item of this.items.values()) {
			if (models && !models.has(item.model)) {
				continue;
			}
			if (
				opts.filePathPrefix &&
				!item.filePath.startsWith(opts.filePathPrefix)
			) {
				continue;
			}

			const score = cosine(vector, item.vector, item.norm);
			out.push({ score, item });
		}

		out.sort((a, b) => b.score - a.score);
		const results = out.slice(0, Math.max(1, topK));

		// update usage stats
		const now = Date.now();
		for (const r of results) {
			const it = this.items.get(r.item.id);
			if (it) {
				it.uses += 1;
				it.lastUsedAt = now;
			}
		}
		if (this.autosave) {
			this.save();
		}
		return results;
	}

	/** Persist immediately (handy if autosave=false). */
	flush() {
		this.save();
	}
}

export function loadHotIndex(opts?: HotIndexOptions) {
	return new HotIndex(opts);
}
