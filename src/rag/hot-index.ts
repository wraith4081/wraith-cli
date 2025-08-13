import fs from 'node:fs';
import path from 'node:path';
import type { ChunkEmbedding, RetrievedChunk } from '@rag/types';
import { hotIndexDir } from '@util/paths';

export interface HotIndexOptions {
	baseDir?: string; // directory for persistence
	capacity?: number; // max items kept in hot index
	writeThroughMs?: number; // debounce writes to disk
}

interface Stored {
	chunk: ChunkEmbedding;
	usage: number;
	lastAccessMs: number;
}

interface StoreV1 {
	version: 1;
	items: Record<string, Stored>;
}

const FILE_NAME = 'hot.store.v1.json';
const DEF_CAPACITY = 1000;
const DEF_WRITE_MS = 300;

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.max(a.length, b.length);
	for (let i = 0; i < n; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	const den = Math.sqrt(na) * Math.sqrt(nb);
	return den > 0 ? dot / den : 0;
}

export interface HotIndexLike {
	search(
		queryVector: number[],
		opts?: { topK?: number; modelFilter?: string; scoreThreshold?: number }
	): Promise<RetrievedChunk[]>;
}

export class HotIndex implements HotIndexLike {
	private readonly dir: string;
	private readonly file: string;
	private readonly capacity: number;
	private readonly writeThroughMs: number;
	private items = new Map<string, Stored>();
	private pendingWrite?: NodeJS.Timeout;

	constructor(opts: HotIndexOptions = {}) {
		this.dir = opts.baseDir ?? hotIndexDir;
		if (!fs.existsSync(this.dir)) {
			fs.mkdirSync(this.dir, { recursive: true });
		}
		this.file = path.join(this.dir, FILE_NAME);
		this.capacity = Math.max(1, opts.capacity ?? DEF_CAPACITY);
		this.writeThroughMs = Math.max(0, opts.writeThroughMs ?? DEF_WRITE_MS);
		this.load();
	}

	async upsert(chunks: ChunkEmbedding[]): Promise<number> {
		let n = 0;
		const now = Date.now();
		for (const c of chunks) {
			const prev = this.items.get(c.id);
			this.items.set(c.id, {
				chunk: c,
				usage: prev?.usage ?? 0,
				lastAccessMs: now,
			});
			n++;
		}
		this.enforceCapacity();
		this.scheduleSave();
		return await Promise.resolve(n);
	}

	async deleteByIds(ids: string[]): Promise<number> {
		let n = 0;
		for (const id of ids) {
			if (this.items.delete(id)) {
				n++;
			}
		}
		if (n > 0) {
			this.scheduleSave();
		}
		return await Promise.resolve(n);
	}

	recordUsage(ids: string[]): void {
		const now = Date.now();
		let touched = false;
		for (const id of ids) {
			const rec = this.items.get(id);
			if (!rec) {
				continue;
			}
			rec.usage++;
			rec.lastAccessMs = now;
			this.items.set(id, rec);
			touched = true;
		}
		if (touched) {
			this.scheduleSave();
		}
	}

	has(id: string): boolean {
		return this.items.has(id);
	}

	async search(
		queryVector: number[],
		opts: {
			topK?: number;
			modelFilter?: string;
			scoreThreshold?: number;
		} = {}
	): Promise<RetrievedChunk[]> {
		const topK = Math.max(1, opts.topK ?? 8);
		const mdl = opts.modelFilter;
		const thr = opts.scoreThreshold;

		// Compute scores
		const scored: RetrievedChunk[] = [];
		for (const rec of this.items.values()) {
			if (mdl && rec.chunk.model !== mdl) {
				continue;
			}
			const s = cosine(queryVector, rec.chunk.vector);
			if (typeof thr === 'number' && s < thr) {
				continue;
			}
			scored.push({ chunk: rec.chunk, score: s, source: 'hot' });
		}
		// Sort desc and take topK
		scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
		const out = scored.slice(0, topK);

		// Update usage for returned hits
		this.recordUsage(out.map((h) => h.chunk.id));
		return await Promise.resolve(out);
	}

	/** Internal: keep at/below capacity via eviction */
	private enforceCapacity(): void {
		const over = this.items.size - this.capacity;
		if (over <= 0) {
			return;
		}

		// Build sortable list [id, usage, lastAccess]
		const arr: Array<{
			id: string;
			usage: number;
			lastAccess: number;
		}> = [];
		for (const [id, rec] of this.items.entries()) {
			arr.push({
				id,
				usage: rec.usage,
				lastAccess: rec.lastAccessMs,
			});
		}
		// Sort ascending by usage, then ascending by lastAccess (oldest first)
		arr.sort((a, b) => a.usage - b.usage || a.lastAccess - b.lastAccess);

		for (let i = 0; i < over; i++) {
			const victim = arr[i];
			if (!victim) {
				break;
			}
			this.items.delete(victim.id);
		}
	}

	private load(): void {
		if (!fs.existsSync(this.file)) {
			return;
		}
		try {
			const raw = fs.readFileSync(this.file, 'utf8');
			const parsed = JSON.parse(raw) as StoreV1;
			if (parsed?.version !== 1 || !parsed.items) {
				return;
			}
			const map = new Map<string, Stored>();
			for (const [id, s] of Object.entries(parsed.items)) {
				// sanity checks
				if (!(s?.chunk?.id && Array.isArray(s.chunk.vector))) {
					continue;
				}
				map.set(id, {
					chunk: s.chunk,
					usage: Math.max(0, Number(s.usage ?? 0)),
					lastAccessMs: Math.max(0, Number(s.lastAccessMs ?? 0)),
				});
			}
			this.items = map;
		} catch {
			// ignore malformed store
		}
	}

	private scheduleSave(): void {
		if (this.writeThroughMs === 0) {
			this.save();
			return;
		}
		if (this.pendingWrite) {
			clearTimeout(this.pendingWrite);
		}
		this.pendingWrite = setTimeout(() => {
			this.save();
			this.pendingWrite = undefined;
		}, this.writeThroughMs);
	}

	private save(): void {
		const obj: StoreV1 = { version: 1, items: {} };
		for (const [id, s] of this.items.entries()) {
			obj.items[id] = s;
		}
		const json = JSON.stringify(obj, null, 2);
		fs.writeFileSync(this.file, json, 'utf8');
		try {
			if (process.platform !== 'win32') {
				fs.chmodSync(this.file, 0o600);
			}
		} catch {
			// ignore
		}
	}

	getBaseDir(): string {
		return this.dir;
	}
}
