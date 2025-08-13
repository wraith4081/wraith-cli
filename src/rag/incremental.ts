import fs from 'node:fs';
import path from 'node:path';
import { type ChunkingConfig, chunkFileContent } from '@ingest/chunking';
import { ingestPaths } from '@ingest/limits';
import type { IProvider } from '@provider/types';
import { embedChunksForRAG } from '@rag/embeddings';
import type { ChunkEmbedding, ColdIndexDriver } from '@rag/types';
import { coldIndexDir } from '@util/paths';

type Plain = Record<string, unknown>;

export interface ManifestFileEntry {
	mtimeMs: number;
	size: number;
	model: string;
	chunkIds: string[];
}

export interface IndexManifestV1 {
	version: 1;
	files: Record<string, ManifestFileEntry>;
}

const MANIFEST_FILENAME = 'manifest.v1.json';

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function manifestPath(baseDir?: string): string {
	const base = baseDir ?? coldIndexDir;
	ensureDir(base);
	return path.join(base, MANIFEST_FILENAME);
}

function loadManifest(baseDir?: string): IndexManifestV1 {
	const p = manifestPath(baseDir);
	if (!fs.existsSync(p)) {
		return { version: 1, files: {} };
	}
	try {
		const raw = fs.readFileSync(p, 'utf8');
		const parsed = JSON.parse(raw) as Plain;
		if ((parsed.version as number) !== 1) {
			return { version: 1, files: {} };
		}
		const files = (parsed.files as Record<string, ManifestFileEntry>) ?? {};
		return { version: 1, files };
	} catch {
		return { version: 1, files: {} };
	}
}

function saveManifest(m: IndexManifestV1, baseDir?: string) {
	const p = manifestPath(baseDir);
	const data = JSON.stringify(m, null, 2);
	fs.writeFileSync(p, data, 'utf8');
	try {
		if (process.platform !== 'win32') {
			fs.chmodSync(p, 0o600);
		}
	} catch {
		// best-effort
	}
}

function toPosixRel(rootDir: string, abs: string): string {
	return path.relative(rootDir, abs).split(path.sep).join('/');
}

function statSafe(p: string): { size: number; mtimeMs: number } {
	const st = fs.statSync(p);
	return { size: st.size, mtimeMs: st.mtimeMs };
}

export interface IncrementalIndexOptions {
	rootDir: string;
	paths: string[]; // absolute or relative to root
	config?: unknown; // merged config for ignore/limits
	chunking?: Partial<ChunkingConfig>;
	profileName?: string;
	modelOverride?: string;
	provider: IProvider;
	coldDrivers: ColdIndexDriver[];
	manifestDir?: string; // defaults to coldIndexDir
}

export interface IncrementalIndexResult {
	model: string;
	files: {
		unchanged: string[];
		changed: string[];
		removed: string[];
	};
	chunks: {
		upserted: number;
		deleted: number;
	};
	timings: {
		totalMs: number;
		embedMs: number;
		upsertMs: number;
		deleteMs: number;
	};
}

export async function incrementalIndex(
	opts: IncrementalIndexOptions
): Promise<IncrementalIndexResult> {
	const t0 = Date.now();
	const manifest = loadManifest(opts.manifestDir);

	// 1) Discover included text files via existing ingestion rules
	const { included } = ingestPaths({
		rootDir: opts.rootDir,
		paths: opts.paths,
		config: opts.config,
	});

	// Build quick lookup for current scan
	const currentRelSet = new Set<string>();
	const changedRel: string[] = [];
	const unchangedRel: string[] = [];

	for (const a of included) {
		const rel = toPosixRel(opts.rootDir, a.absPath);
		currentRelSet.add(rel);

		// Compare size + mtime vs manifest
		const { size, mtimeMs } = statSafe(a.absPath);
		const prev = manifest.files[rel];
		if (!prev || prev.size !== size || prev.mtimeMs !== mtimeMs) {
			changedRel.push(rel);
		} else {
			unchangedRel.push(rel);
		}
	}

	// Removed files = in manifest but not in current scan
	const removedRel = Object.keys(manifest.files).filter(
		(rel) => !currentRelSet.has(rel)
	);

	// 2) For changed files, re-chunk and compute new chunk ids
	type ChangedPlan = {
		rel: string;
		size: number;
		mtimeMs: number;
		newIds: string[];
		chunks: ReturnType<typeof chunkFileContent>;
	};
	const plans: ChangedPlan[] = [];
	for (const rel of changedRel) {
		const abs = path.join(opts.rootDir, rel);
		const content = fs.readFileSync(abs, 'utf8');
		const chunks = chunkFileContent(rel, content, opts.chunking);
		const newIds = chunks.map((c) => c.sha256);
		const { size, mtimeMs } = statSafe(abs);
		plans.push({ rel, size, mtimeMs, newIds, chunks });
	}

	// 3) Determine which chunk IDs to delete (removed + changed deltas)
	const toDelete = new Set<string>();
	for (const rel of removedRel) {
		const prev = manifest.files[rel];
		for (const id of prev?.chunkIds ?? []) {
			toDelete.add(id);
		}
	}
	for (const p of plans) {
		const prev = manifest.files[p.rel];
		if (prev) {
			for (const oldId of prev.chunkIds) {
				if (!p.newIds.includes(oldId)) {
					toDelete.add(oldId);
				}
			}
		}
	}

	// 4) Embed new/changed chunks
	const allNewChunks = plans.flatMap((p) => p.chunks);
	let embedMs = 0;
	let embeddings: ChunkEmbedding[] = [];
	let modelUsed = opts.modelOverride ?? 'text-embedding-3-large';
	if (allNewChunks.length > 0) {
		const e0 = Date.now();
		embeddings = await embedChunksForRAG(
			opts.provider,
			opts.config,
			allNewChunks,
			{
				profileName: opts.profileName,
				modelOverride: opts.modelOverride,
			}
		);
		embedMs = Date.now() - e0;
		if (embeddings.length > 0) {
			modelUsed = embeddings[0]?.model ?? modelUsed;
		}
	}

	// 5) Upsert & delete against cold drivers
	let upsertMs = 0;
	let deleteMs = 0;
	if (embeddings.length > 0 && opts.coldDrivers.length > 0) {
		const u0 = Date.now();
		// best-effort across drivers
		for (const d of opts.coldDrivers) {
			await d.upsert(embeddings);
		}
		upsertMs = Date.now() - u0;
	}
	const toDeleteArr = Array.from(toDelete);
	if (toDeleteArr.length > 0 && opts.coldDrivers.length > 0) {
		const d0 = Date.now();
		for (const d of opts.coldDrivers) {
			await d.deleteByIds?.(toDeleteArr);
		}
		deleteMs = Date.now() - d0;
	}

	// 6) Update and persist manifest
	for (const p of plans) {
		manifest.files[p.rel] = {
			mtimeMs: p.mtimeMs,
			size: p.size,
			model: modelUsed,
			chunkIds: p.newIds.slice(),
		};
	}
	for (const rel of removedRel) {
		delete manifest.files[rel];
	}
	saveManifest(manifest, opts.manifestDir);

	return {
		model: modelUsed,
		files: {
			unchanged: unchangedRel,
			changed: changedRel,
			removed: removedRel,
		},
		chunks: {
			upserted: embeddings.length,
			deleted: toDeleteArr.length,
		},
		timings: {
			totalMs: Date.now() - t0,
			embedMs,
			upsertMs,
			deleteMs,
		},
	};
}
