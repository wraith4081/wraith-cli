import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildIgnoreFilterFromConfig, type PathFilter } from '@ingest/ignore';
import { ConfigV1Z, IngestionConfigZ } from '@store/schema';

export type BinaryPolicy = 'skip' | 'hash' | 'summary';

export interface IngestionSettings {
	rootDir: string;
	useGitIgnore: boolean;
	patterns: string[];
	includeAlways: string[];
	maxFileSize: number; // bytes
	maxFiles?: number; // undefined => no cap
	binaryPolicy: BinaryPolicy;
}

export interface Attachment {
	relPath: string;
	absPath: string;
	bytes: number;
	isBinary: boolean;
	included: boolean; // true only when content is attached
	reason?: 'oversize' | 'binary' | 'symlink' | 'maxFiles' | 'io-error';
	hashSha256?: string; // for binaryPolicy=hash
	summaryNote?: string; // for binaryPolicy=summary
	content?: string; // only for included text files
	tokenEstimate?: number; // only for included content
}

export interface IngestionSummary {
	included: Attachment[]; // with content
	skipped: Attachment[]; // metadata only (oversize, binary, symlink, maxFiles, errors)
	totals: {
		filesDiscovered: number;
		filesConsidered: number; // after ignore filtering
		filesIncluded: number;
		bytesTotal: number;
		bytesIncluded: number;
		tokensEstimatedIncluded: number;
	};
	warnings: string[];
}

const DEFAULT_MAX_FILE_SIZE = 1_048_576; // 1 MiB
const DEFAULT_BINARY_POLICY: BinaryPolicy = 'skip';

function fromConfig(rootDir: string, cfgUnknown?: unknown): IngestionSettings {
	const parsed = ConfigV1Z.safeParse(cfgUnknown);
	const ingestion = parsed.success
		? IngestionConfigZ.parse(parsed.data.defaults?.ingestion)
		: IngestionConfigZ.parse(undefined); // schema defaults for ignore
	return {
		rootDir: path.resolve(rootDir),
		useGitIgnore: ingestion.ignore?.useGitIgnore ?? true,
		patterns: ingestion.ignore?.patterns ?? [],
		includeAlways: ingestion.ignore?.includeAlways ?? ['.wraith/**'],
		maxFileSize: ingestion.maxFileSize ?? DEFAULT_MAX_FILE_SIZE,
		maxFiles: ingestion.maxFiles,
		binaryPolicy: ingestion.binaryPolicy ?? DEFAULT_BINARY_POLICY,
	};
}

function isBinaryBuffer(buf: Buffer): boolean {
	// Heuristic: null bytes or high ratio of non-printable characters => binary
	if (buf.includes(0)) {
		return true;
	}
	let nonPrintable = 0;
	const len = Math.min(buf.length, 8192); // sample up to 8 KiB
	for (let i = 0; i < len; i++) {
		const c = buf[i];
		const printable =
			c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e);
		if (!printable) {
			nonPrintable++;
		}
	}
	return nonPrintable / Math.max(1, len) > 0.3;
}

function estimateTokensFromBytes(bytes: number): number {
	// Rough heuristic: ~4 bytes/token for English text
	return Math.ceil(bytes / 4);
}

function sha256(buf: Buffer): string {
	const h = crypto.createHash('sha256');
	h.update(buf);
	return h.digest('hex');
}

function listAllFiles(start: string, ignoreFilter: PathFilter): string[] {
	const results: string[] = [];
	const root = path.resolve(start);

	function walk(dir: string) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const abs = path.join(dir, e.name);
			if (e.isSymbolicLink()) {
				// Do not follow symlinks to avoid escapes; record as skipped later if asked explicitly
				continue;
			}
			if (e.isDirectory()) {
				if (ignoreFilter(abs, true)) {
					walk(abs);
				}
			} else if (e.isFile() && ignoreFilter(abs, false)) {
				results.push(abs);
			}
		}
	}

	const stat = fs.statSync(root);
	if (stat.isDirectory()) {
		walk(root);
	} else if (stat.isFile() && ignoreFilter(root, false)) {
		results.push(root);
	}
	return results;
}

function toRelPosix(rootDir: string, absPath: string): string {
	return path.relative(rootDir, absPath).split(path.sep).join('/');
}

function processFile(absPath: string, settings: IngestionSettings): Attachment {
	const relPath = toRelPosix(settings.rootDir, absPath);
	try {
		const st = fs.lstatSync(absPath);
		if (st.isSymbolicLink()) {
			return {
				relPath,
				absPath,
				bytes: 0,
				isBinary: false,
				included: false,
				reason: 'symlink',
			};
		}
		if (!st.isFile()) {
			return {
				relPath,
				absPath,
				bytes: 0,
				isBinary: false,
				included: false,
				reason: 'io-error',
			};
		}

		const bytes = st.size;
		// Oversize handling (chunking will come in 6.x)
		if (settings.maxFileSize > 0 && bytes > settings.maxFileSize) {
			return {
				relPath,
				absPath,
				bytes,
				isBinary: false,
				included: false,
				reason: 'oversize',
			};
		}

		const buf = fs.readFileSync(absPath);
		const isBinary = isBinaryBuffer(buf);

		if (isBinary) {
			if (settings.binaryPolicy === 'skip') {
				return {
					relPath,
					absPath,
					bytes,
					isBinary: true,
					included: false,
					reason: 'binary',
				};
			}
			if (settings.binaryPolicy === 'hash') {
				return {
					relPath,
					absPath,
					bytes,
					isBinary: true,
					included: false,
					reason: 'binary',
					hashSha256: sha256(buf),
				};
			}
			// summary
			return {
				relPath,
				absPath,
				bytes,
				isBinary: true,
				included: false,
				reason: 'binary',
				summaryNote: 'Binary file excluded from context.',
			};
		}

		// Text file: include content
		const content = buf.toString('utf8');
		const tokenEstimate = estimateTokensFromBytes(
			Buffer.byteLength(content, 'utf8')
		);
		return {
			relPath,
			absPath,
			bytes,
			isBinary: false,
			included: true,
			content,
			tokenEstimate,
		};
	} catch {
		return {
			relPath,
			absPath,
			bytes: 0,
			isBinary: false,
			included: false,
			reason: 'io-error',
		};
	}
}

export interface IngestPathsInput {
	rootDir: string;
	paths: string[]; // absolute or relative to root
	config?: unknown; // merged config for defaults.ingestion
}

export function ingestPaths(input: IngestPathsInput): IngestionSummary {
	const settings = fromConfig(input.rootDir, input.config);
	const ignoreFilter = buildIgnoreFilterFromConfig(
		settings.rootDir,
		input.config
	);

	// Collect files
	const discoveredFiles: string[] = [];
	for (const p of input.paths) {
		const abs = path.isAbsolute(p) ? p : path.resolve(settings.rootDir, p);
		if (!fs.existsSync(abs)) {
			continue;
		}
		const stat = fs.statSync(abs);
		if (stat.isDirectory() || stat.isFile()) {
			const listed = listAllFiles(abs, ignoreFilter);
			for (const f of listed) {
				discoveredFiles.push(f);
			}
		}
	}

	const filesConsidered = discoveredFiles.length;

	// Apply maxFiles cap
	const filesToProcess =
		typeof settings.maxFiles === 'number' && settings.maxFiles > 0
			? discoveredFiles.slice(0, settings.maxFiles)
			: discoveredFiles.slice();

	const attachments: Attachment[] = filesToProcess.map((f) =>
		processFile(f, settings)
	);

	// Mark any remaining as skipped due to maxFiles
	if (filesToProcess.length < discoveredFiles.length) {
		for (const f of discoveredFiles.slice(filesToProcess.length)) {
			attachments.push({
				relPath: toRelPosix(settings.rootDir, f),
				absPath: f,
				bytes: fs.existsSync(f) ? fs.statSync(f).size : 0,
				isBinary: false,
				included: false,
				reason: 'maxFiles',
			});
		}
	}

	const included = attachments.filter((a) => a.included);
	const skipped = attachments.filter((a) => !a.included);

	const totals = {
		filesDiscovered: discoveredFiles.length,
		filesConsidered,
		filesIncluded: included.length,
		bytesTotal: attachments.reduce((acc, a) => acc + a.bytes, 0),
		bytesIncluded: included.reduce((acc, a) => acc + a.bytes, 0),
		tokensEstimatedIncluded: included.reduce(
			(acc, a) => acc + (a.tokenEstimate ?? 0),
			0
		),
	};

	const warnings: string[] = [];
	if (skipped.some((s) => s.reason === 'oversize')) {
		warnings.push(
			'Some files were skipped due to maxFileSize. Consider enabling chunking (planned in a later task).'
		);
	}
	if (skipped.some((s) => s.reason === 'binary')) {
		warnings.push(
			`Binary files excluded by policy (${settings.binaryPolicy}).`
		);
	}
	if (skipped.some((s) => s.reason === 'maxFiles')) {
		warnings.push('Some files were skipped due to maxFiles limit.');
	}

	return { included, skipped, totals, warnings };
}

export function formatPreSendSummary(summary: IngestionSummary): string {
	const lines: string[] = [];
	lines.push(
		`Context attachments: ${summary.totals.filesIncluded}/${summary.totals.filesDiscovered} files included`
	);
	lines.push(
		`Included bytes: ${summary.totals.bytesIncluded} (est. tokens ~${summary.totals.tokensEstimatedIncluded})`
	);

	const counts: Record<string, number> = {};
	for (const s of summary.skipped) {
		counts[s.reason ?? 'other'] = (counts[s.reason ?? 'other'] ?? 0) + 1;
	}
	const skippedParts = Object.entries(counts)
		.map(([k, v]) => `${v} ${k}`)
		.join(', ');
	if (summary.skipped.length > 0) {
		lines.push(`Skipped: ${summary.skipped.length} (${skippedParts})`);
	}
	for (const w of summary.warnings) {
		lines.push(`Warning: ${w}`);
	}
	return lines.join('\n');
}
