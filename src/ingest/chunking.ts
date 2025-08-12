import crypto from 'node:crypto';
import path from 'node:path';

import { type Attachment, ingestPaths } from '@ingest/limits';

export type FileType = 'markdown' | 'code' | 'json' | 'text';

export interface ChunkingConfig {
	chunkSizeTokens: number; // default ~800
	overlapTokens: number; // default ~200
	maxChunksPerFile?: number; // default 200
}

export interface Chunk {
	filePath: string; // relative posix path
	startLine: number; // 1-based, inclusive
	endLine: number; // 1-based, inclusive
	chunkIndex: number; // 0-based
	chunkCount: number;
	sha256: string;
	content: string;
	tokensEstimated: number;

	fileType: FileType;
}

export interface ChunksSummary {
	chunks: Chunk[];
	skipped: Attachment[];
	totals: {
		filesIncluded: number;
		chunks: number;
		tokensEstimated: number;
	};
	warnings: string[];
}

const DEFAULT_CHUNK_SIZE_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 200;
const DEFAULT_MAX_CHUNKS_PER_FILE = 200;

function approxTokenToCharBudget(tokens: number): number {
	return Math.max(16, Math.floor(tokens * 4));
}

function sha256Text(text: string): string {
	const h = crypto.createHash('sha256');
	h.update(text, 'utf8');
	return h.digest('hex');
}

function countTokensApprox(text: string): number {
	return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export function detectFileType(relPath: string, content: string): FileType {
	const ext = path.extname(relPath).toLowerCase();
	if (ext === '.md' || ext === '.mdx') {
		return 'markdown';
	}
	if (ext === '.json' || ext === '.jsonc') {
		return 'json';
	}
	if (
		[
			'.ts',
			'.tsx',
			'.js',
			'.jsx',
			'.mjs',
			'.cjs',
			'.rs',
			'.go',
			'.py',
			'.java',
			'.kt',
			'.rb',
			'.sh',
			'.bash',
			'.zsh',
			'.fish',
			'.sql',
			'.yaml',
			'.yml',
			'.toml',
			'.ini',
			'.cfg',
			'.conf',
			'.cs',
			'.cpp',
			'.c',
			'.h',
			'.hpp',
			'.swift',
			'.php',
		].includes(ext)
	) {
		return 'code';
	}
	if (/^#\s/m.test(content)) {
		return 'markdown';
	}
	return 'text';
}
function chunkLinesByBudget(
	lines: string[],
	budgetChars: number,
	overlapChars: number,
	type: FileType
): { start: number; end: number }[] {
	const bounds: { start: number; end: number }[] = [];
	const N = lines.length;
	let s = 0;

	// Fence utilities only used for markdown
	const isFenceLineAt: boolean[] = [];
	const insideFenceAt: boolean[] = [];
	const isFence = (line: string): boolean =>
		/^(?:`{3,}|~{3,})/.test(line.trim());

	if (type === 'markdown') {
		let inside = false;
		for (let i = 0; i < N; i++) {
			const fence = isFence(lines[i] ?? '');
			isFenceLineAt[i] = fence;
			insideFenceAt[i] = inside;
			if (fence) {
				inside = !inside;
			}
		}
	}

	while (s < N) {
		let used = 0;
		let e = s;
		let lastGoodBreak = -1;
		let extendedToCloseFence = false;

		// Track fence state while growing this chunk
		let insideFence = type === 'markdown' && insideFenceAt[s] === true;

		const considerBreak = (idx: number) => {
			const line = lines[idx];
			const trimmed = line.trim();
			if (trimmed === '') {
				lastGoodBreak = idx;
				return;
			}
			if (type === 'markdown' && /^#{1,6}\s/.test(trimmed)) {
				lastGoodBreak = idx - 1;
				return;
			}
			if (type === 'code' && /[;}]\s*$/.test(trimmed)) {
				lastGoodBreak = idx;
				return;
			}
			if ((idx - s) % 50 === 0 && idx > s) {
				lastGoodBreak = idx;
			}
		};

		// Grow until budget reached
		while (e < N) {
			const line = lines[e];
			if (type === 'markdown' && isFence(line)) {
				insideFence = !insideFence;
			}
			const cost = Buffer.byteLength(line, 'utf8') + 1; // newline
			if (used + cost > budgetChars) {
				break;
			}
			used += cost;
			considerBreak(e);
			e++;
		}

		// If we ended mid-fence for markdown, continue until fence closes or EOF
		if (type === 'markdown' && insideFence) {
			extendedToCloseFence = true;
			while (e < N) {
				const line = lines[e];
				const cost = Buffer.byteLength(line, 'utf8') + 1;
				used += cost;
				if (isFence(line)) {
					insideFence = !insideFence;
					e++; // include the closing fence line
					break;
				}
				e++;
			}
		}

		// Choose a natural break if possible; but do not move back inside a fence we just closed.
		let end = e - 1;
		if (!extendedToCloseFence && lastGoodBreak >= s && lastGoodBreak < e) {
			end = Math.max(s, lastGoodBreak);
		}
		if (end < s) {
			end = s; // ensure at least one line
		}

		bounds.push({ start: s, end });

		if (end >= N - 1) {
			break;
		}

		// Compute nextStart with overlap
		const nextStartWithoutOverlap = end + 1;
		let nextStart = nextStartWithoutOverlap;

		if (overlapChars > 0) {
			let overlapAccum = 0;
			let back = end;
			while (back >= 0 && overlapAccum < overlapChars) {
				overlapAccum += Buffer.byteLength(lines[back], 'utf8') + 1;
				back--;
			}
			nextStart = Math.max(back + 1, s + 1);
		}

		// Ensure forward progress
		if (nextStart <= s) {
			nextStart = nextStartWithoutOverlap;
		}

		// For markdown, avoid starting a chunk on a fence line or inside a fenced block.
		if (type === 'markdown') {
			while (
				nextStart < N &&
				(isFenceLineAt[nextStart] === true ||
					insideFenceAt[nextStart] === true)
			) {
				nextStart++;
			}
		}

		s = nextStart;
	}

	return bounds;
}

export function chunkFileContent(
	relPath: string,
	content: string,
	cfg?: Partial<ChunkingConfig>
): Chunk[] {
	const fileType = detectFileType(relPath, content);
	const budgetChars = approxTokenToCharBudget(
		cfg?.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS
	);
	const overlapChars = approxTokenToCharBudget(
		cfg?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
	);
	const maxChunksPerFile =
		cfg?.maxChunksPerFile ?? DEFAULT_MAX_CHUNKS_PER_FILE;

	const lines = content.split(/\r?\n/);
	const bounds = chunkLinesByBudget(
		lines,
		budgetChars,
		overlapChars,
		fileType
	);

	const limitedBounds = bounds.slice(0, maxChunksPerFile);
	const chunks: Chunk[] = limitedBounds.map((b, i) => {
		const slice = lines.slice(b.start, b.end + 1).join('\n');
		return {
			filePath: relPath.split(path.sep).join('/'),
			startLine: b.start + 1,
			endLine: b.end + 1,
			chunkIndex: i,
			chunkCount: limitedBounds.length,
			sha256: sha256Text(slice),
			content: slice,
			tokensEstimated: countTokensApprox(slice),
			fileType,
		};
	});

	return chunks;
}

export interface IngestAndChunkInput {
	rootDir: string;
	paths: string[];
	config?: unknown; // merged config for ignore/limits
	chunking?: Partial<ChunkingConfig>;
}

export function ingestAndChunkPaths(input: IngestAndChunkInput): ChunksSummary {
	const {
		included,
		skipped,
		warnings: ingestWarnings,
	} = ingestPaths({
		rootDir: input.rootDir,
		paths: input.paths,
		config: input.config,
	});

	const chunks: Chunk[] = [];
	const chunkWarnings: string[] = [];

	for (const att of included) {
		const rel = att.relPath;
		const content = att.content ?? '';
		const fileChunks = chunkFileContent(rel, content, input.chunking);

		if (fileChunks.length === 0) {
			continue;
		}

		// Detect truncation vs. expected bounds
		const expectedBounds = chunkLinesByBudget(
			content.split(/\r?\n/),
			approxTokenToCharBudget(
				input.chunking?.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS
			),
			approxTokenToCharBudget(
				input.chunking?.overlapTokens ?? DEFAULT_OVERLAP_TOKENS
			),
			detectFileType(rel, content)
		);
		const maxChunks =
			input.chunking?.maxChunksPerFile ?? DEFAULT_MAX_CHUNKS_PER_FILE;
		if (
			expectedBounds.length > maxChunks &&
			fileChunks.length === maxChunks
		) {
			chunkWarnings.push(
				`File ${rel} produced ${expectedBounds.length} chunks; truncated to maxChunksPerFile=${maxChunks}.`
			);
		}

		chunks.push(...fileChunks);
	}

	const totals = {
		filesIncluded: included.length,
		chunks: chunks.length,
		tokensEstimated: chunks.reduce((acc, c) => acc + c.tokensEstimated, 0),
	};

	return {
		chunks,
		skipped,
		totals,
		warnings: [...ingestWarnings, ...chunkWarnings],
	};
}
