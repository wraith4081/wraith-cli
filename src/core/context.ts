import path from 'node:path';
import { type ChunkingConfig, ingestAndChunkPaths } from '@ingest/chunking';
import { formatPreSendSummary } from '@ingest/limits';
import {
	type FetchUrlOptions,
	fetchAndNormalizeUrls,
	type UrlAttachment,
} from '@ingest/url';

export interface AttachmentSummaryInput {
	rootDir: string;
	filePaths?: string[];
	dirPaths?: string[];
	urls?: string[];
	config?: unknown;
	chunking?: Partial<ChunkingConfig>;
	fetch?: FetchUrlOptions;
}

export interface AttachmentSummary {
	lines: string[];
	totals: {
		filesIncluded: number;
		chunks: number;
		tokensFromFiles: number;
		urlsIncluded: number;
		tokensFromUrls: number;
		tokensTotal: number;
	};
	files: {
		lines: string[];
		warnings: string[];
	};
	urls: {
		included: UrlAttachment[];
		skipped: UrlAttachment[];
	};
}

export async function computeAttachmentSummary(
	input: AttachmentSummaryInput
): Promise<AttachmentSummary> {
	const rootDir = path.resolve(input.rootDir);
	const filesArg = input.filePaths ?? [];
	const dirsArg = input.dirPaths ?? [];
	const urlsArg = input.urls ?? [];

	const paths = [...filesArg, ...dirsArg];

	// Files/Dirs: ingest + chunk
	const chunksRes = ingestAndChunkPaths({
		rootDir,
		paths,
		config: input.config,
		chunking: input.chunking,
	});

	const filesSummaryLines: string[] = [];
	if (paths.length > 0) {
		filesSummaryLines.push(
			formatPreSendSummary({
				included: [],
				skipped: [],
				totals: {
					filesDiscovered: chunksRes.totals.filesIncluded, // after ignore/limits
					filesConsidered: chunksRes.totals.filesIncluded,
					filesIncluded: chunksRes.totals.filesIncluded,
					bytesTotal: 0, // not tracked at chunk stage; formatPreSendSummary requires a full summary, so keep simple
					bytesIncluded: 0,
					tokensEstimatedIncluded: chunksRes.totals.tokensEstimated,
				},
				warnings: chunksRes.warnings,
			})
		);
		filesSummaryLines.push(
			`Chunks produced: ${chunksRes.totals.chunks} across ${chunksRes.totals.filesIncluded} file(s)`
		);
	}

	// URLs: fetch and normalize
	let urlIncluded: UrlAttachment[] = [];
	let urlSkipped: UrlAttachment[] = [];
	if (urlsArg.length > 0) {
		const { included, skipped } = await fetchAndNormalizeUrls(
			urlsArg,
			input.fetch
		);
		urlIncluded = included;
		urlSkipped = skipped;
	}

	const tokensFromFiles = chunksRes.totals.tokensEstimated;
	const tokensFromUrls = urlIncluded.reduce(
		(acc, a) => acc + (a.tokenEstimate ?? 0),
		0
	);
	const totals = {
		filesIncluded: chunksRes.totals.filesIncluded,
		chunks: chunksRes.totals.chunks,
		tokensFromFiles,
		urlsIncluded: urlIncluded.length,
		tokensFromUrls,
		tokensTotal: tokensFromFiles + tokensFromUrls,
	};

	// Build final lines
	const lines: string[] = [];
	lines.push('Context summary:');
	if (paths.length > 0) {
		lines.push('- Files/Dirs:');
		lines.push(...filesSummaryLines.map((l) => `  ${l}`));
	}
	if (urlsArg.length > 0) {
		lines.push('- URLs:');
		lines.push(
			`  Included ${urlIncluded.length} URL(s); Skipped ${urlSkipped.length}`
		);
		lines.push(`  Estimated tokens from URLs: ~${tokensFromUrls}`);
		// Print a short list of included URLs (with titles if available)
		for (const u of urlIncluded.slice(0, 5)) {
			// cap list for brevity
			const label = u.title ? `${u.title} (${u.url})` : u.url;
			lines.push(`  • ${label}`);
		}
		if (urlIncluded.length > 5) {
			lines.push(`  • … ${urlIncluded.length - 5} more`);
		}
	}
	lines.push(`Total estimated tokens from context: ~${totals.tokensTotal}`);

	return {
		lines,
		totals,
		files: { lines: filesSummaryLines, warnings: chunksRes.warnings },
		urls: { included: urlIncluded, skipped: urlSkipped },
	};
}
