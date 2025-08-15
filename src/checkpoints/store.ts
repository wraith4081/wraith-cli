import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildIgnoreFilterFromConfig } from '@ingest/ignore';
import { loadConfig } from '@store/config';
import { checkpointsDir as staticCheckpointsDir } from '@util/paths';

type Plain = Record<string, unknown>;

export interface CheckpointFile {
	path: string; // posix relative
	size: number;
	sha256: string;
}

export interface CheckpointManifestV1 {
	version: 1;
	meta: {
		id: string;
		label?: string;
		createdAt: number;
		files: number;
		bytes: number;
	};
	files: CheckpointFile[];
}

export function sanitizeLabel(s?: string): string | undefined {
	if (!s) {
		return;
	}
	const t = s
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gi, '-')
		.replace(/^-+|-+$/g, '');
	return t || undefined;
}

function sha256(buf: Buffer): string {
	const h = crypto.createHash('sha256');
	h.update(buf);
	return h.digest('hex');
}

function randId(bytes = 4): string {
	return crypto.randomBytes(bytes).toString('hex');
}

function toPosix(rel: string): string {
	return rel.split(path.sep).join('/');
}

function ensureDir(p: string) {
	if (!fs.existsSync(p)) {
		fs.mkdirSync(p, { recursive: true });
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(p, 0o700);
			} catch {
				/* ignore */
			}
		}
	}
}

function currentCheckpointsDir(): string {
	return path.join(process.cwd(), '.wraith', 'checkpoints');
}

function realCheckpointsDir(): string {
	// Ensure the static dir also exists so other parts of code that look at
	// staticCheckpointsDir see a truthy path in tests.
	const dyn = currentCheckpointsDir();
	ensureDir(dyn);
	if (dyn !== staticCheckpointsDir) {
		ensureDir(staticCheckpointsDir);
	}
	return dyn;
}

function listAllFiles(
	root: string,
	extraIgnore: (p: string, isDir?: boolean) => boolean
): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const abs = path.join(dir, e.name);
			let lst: fs.Stats | fs.BigIntStats | undefined;
			try {
				lst = fs.lstatSync(abs);
			} catch {
				continue;
			}
			if (lst.isSymbolicLink()) {
				continue; // skip symlinks
			}
			const isDir = lst.isDirectory();
			const rel = path.relative(root, abs);
			if (!extraIgnore(rel, isDir)) {
				continue;
			}
			if (isDir) {
				walk(abs);
			} else if (lst.isFile()) {
				out.push(abs);
			}
		}
	};
	walk(root);
	return out;
}

export async function createCheckpoint(
	rootDir: string,
	opts: { label?: string } = {}
): Promise<{
	dir: string;
	manifestPath: string;
	meta: CheckpointManifestV1['meta'];
}> {
	const { merged } = loadConfig();
	const baseFilter = buildIgnoreFilterFromConfig(rootDir, merged);
	const filter = (relOrAbs: string, isDir?: boolean) => {
		const rel = path.isAbsolute(relOrAbs)
			? path.relative(rootDir, relOrAbs)
			: relOrAbs;
		// Force-exclude the checkpoints directory to avoid recursive snapshots.
		const posix = toPosix(rel);
		if (posix.startsWith('.wraith/checkpoints/')) {
			return false;
		}
		return baseFilter(rel, isDir);
	};

	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const id = `${ts}-${randId(4)}`;
	const label = sanitizeLabel(opts.label);
	const dir = path.join(
		realCheckpointsDir(),
		id + (label ? `-${label}` : '')
	);
	const filesRoot = path.join(dir, 'files');
	ensureDir(filesRoot);

	let count = 0;
	let total = 0;
	const files: CheckpointFile[] = [];

	const all = listAllFiles(rootDir, filter);
	for (const abs of all) {
		const rel = path.relative(rootDir, abs);
		const posix = toPosix(rel);
		const buf = fs.readFileSync(abs);
		const hash = sha256(buf);
		const dest = path.join(filesRoot, rel);
		ensureDir(path.dirname(dest));
		fs.writeFileSync(dest, buf);
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dest, 0o600);
			} catch {
				/* ignore */
			}
		}
		files.push({ path: posix, size: buf.length, sha256: hash });
		count++;
		total += buf.length;
	}

	const manifest: CheckpointManifestV1 = {
		version: 1,
		meta: { id, label, createdAt: Date.now(), files: count, bytes: total },
		files,
	};
	const manifestPath = path.join(dir, 'manifest.json');
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(manifestPath, 0o600);
		} catch {
			/* ignore */
		}
	}
	return await Promise.resolve({ dir, manifestPath, meta: manifest.meta });
}

function findCheckpointDirByPrefix(prefix: string): string {
	const dir = realCheckpointsDir();
	let entries: string[] = [];
	try {
		entries = fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => d.name);
	} catch {
		entries = [];
	}
	if (entries.length === 0) {
		throw new Error(`No checkpoints directory found at ${dir}`);
	}
	// Match by prefix of directory name (which starts with id)
	const match = entries.find((e) => e.startsWith(prefix));
	if (!match) {
		throw new Error(`Checkpoint not found for: ${prefix}`);
	}
	return path.join(dir, match);
}

export async function restoreCheckpoint(
	rootDir: string,
	idOrPrefix: string,
	opts: { dryRun?: boolean; force?: boolean } = {}
): Promise<{
	checkpointId: string;
	label?: string;
	restored: number;
	overwrites: string[];
	backupDir?: string;
}> {
	const cdir = findCheckpointDirByPrefix(idOrPrefix);
	const manifestPath = path.join(cdir, 'manifest.json');
	const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Plain;
	if (raw.version !== 1 || !raw.meta || !Array.isArray(raw.files)) {
		throw new Error(`Invalid checkpoint manifest: ${manifestPath}`);
	}
	const meta = raw.meta as CheckpointManifestV1['meta'];
	const files = (raw.files as Plain[]).map((f) => ({
		path: String(f.path),
		size: Number(f.size),
		sha256: String(f.sha256),
	}));

	const filesRoot = path.join(cdir, 'files');
	const overwrites: string[] = [];
	for (const f of files) {
		const dest = path.join(rootDir, f.path.split('/').join(path.sep));
		if (fs.existsSync(dest)) {
			overwrites.push(f.path);
		}
	}
	if (opts.dryRun) {
		return await Promise.resolve({
			checkpointId: meta.id,
			label: meta.label,
			restored: files.length,
			overwrites,
		});
	}
	if (overwrites.length > 0 && !opts.force) {
		throw new Error(
			`Refusing to overwrite ${overwrites.length} existing file(s) without --force`
		);
	}

	let backupDir: string | undefined;
	if (overwrites.length > 0) {
		backupDir = path.join(
			realCheckpointsDir(),
			'_restore-backups',
			`${meta.id}-${randId(3)}`
		);
		ensureDir(backupDir);
	}

	for (const f of files) {
		const src = path.join(filesRoot, f.path.split('/').join(path.sep));
		const dest = path.join(rootDir, f.path.split('/').join(path.sep));
		const parent = path.dirname(dest);
		ensureDir(parent);
		if (backupDir && fs.existsSync(dest)) {
			const bpath = path.join(
				backupDir,
				f.path.split('/').join(path.sep)
			);
			ensureDir(path.dirname(bpath));
			const cur = fs.readFileSync(dest);
			fs.writeFileSync(bpath, cur);
			if (process.platform !== 'win32') {
				try {
					fs.chmodSync(bpath, 0o600);
				} catch {
					/* ignore */
				}
			}
		}
		const buf = fs.readFileSync(src);
		fs.writeFileSync(dest, buf);
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dest, 0o600);
			} catch {
				/* ignore */
			}
		}
	}

	return await Promise.resolve({
		checkpointId: meta.id,
		label: meta.label,
		restored: files.length,
		overwrites,
		backupDir,
	});
}
