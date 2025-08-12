import fs from 'node:fs';
import path from 'node:path';
import { ConfigV1Z, IngestionConfigZ } from '@store/schema';
import ignore, { type Ignore } from 'ignore';

export interface IgnoreFilterOptions {
	rootDir: string;
	useGitIgnore?: boolean;
	patterns?: string[];
	includeAlways?: string[];
	gitignorePath?: string; // override for tests
}

export type PathFilter = (absOrRelPath: string, isDir?: boolean) => boolean;

export function buildIgnoreFilterFromSettings(
	opts: IgnoreFilterOptions
): PathFilter {
	const rootDir = path.resolve(opts.rootDir);
	const ig: Ignore = ignore();
	const includeMatch: Ignore = ignore();

	// Load .gitignore if requested and present
	if (opts.useGitIgnore !== false) {
		const gitignore =
			opts.gitignorePath ?? path.join(rootDir, '.gitignore');
		if (fs.existsSync(gitignore)) {
			const raw = fs.readFileSync(gitignore, 'utf8');
			ig.add(raw);
		}
	}

	// Add extra ignore patterns (project overrides)
	if (opts.patterns?.length) {
		ig.add(opts.patterns);
	}

	// includeAlways (exceptions) — match these first to always include
	const always = opts.includeAlways ?? ['.wraith/**'];
	if (always.length) {
		includeMatch.add(always);
	}

	const toRelPosix = (p: string, isDir?: boolean): string => {
		const abs = path.isAbsolute(p) ? p : path.join(rootDir, p);
		const rel = path.relative(rootDir, abs);
		// Normalize to posix for ignore library; add trailing slash for dirs
		const posix = rel.split(path.sep).join('/');
		return isDir && !posix.endsWith('/') ? `${posix}/` : posix;
	};

	return (absOrRelPath: string, isDir?: boolean): boolean => {
		const rel = toRelPosix(absOrRelPath, isDir);
		// Always include if matches includeAlways
		if (rel && includeMatch.ignores(rel)) {
			return true;
		}
		// Otherwise include when not ignored
		const ignored = rel ? ig.ignores(rel) : false;
		return !ignored;
	};
}

export function buildIgnoreFilterFromConfig(
	rootDir: string,
	cfgUnknown?: unknown
): PathFilter {
	const parsed = ConfigV1Z.safeParse(cfgUnknown);
	const ingestion = parsed.success
		? IngestionConfigZ.parse(parsed.data.defaults?.ingestion)
		: IngestionConfigZ.parse(undefined); // gets schema defaults
	return buildIgnoreFilterFromSettings({
		rootDir,
		useGitIgnore: ingestion.ignore?.useGitIgnore,
		patterns: ingestion.ignore?.patterns,
		includeAlways: ingestion.ignore?.includeAlways,
	});
}
