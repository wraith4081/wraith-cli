import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildIgnoreFilterFromConfig } from '@ingest/ignore';
import { loadConfig } from '@store/config';
import { checkpointsDir as staticCheckpointsDir } from '@util/paths';

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

function isBinaryBuffer(buf: Buffer): boolean {
	if (buf.includes(0)) {
		return true;
	}
	let nonPrintable = 0;
	const n = Math.min(buf.length, 8192);
	for (let i = 0; i < n; i++) {
		const c = buf[i];
		const printable =
			c === 0x09 || c === 0x0a || c === 0x0d || (c >= 0x20 && c <= 0x7e);
		if (!printable) {
			nonPrintable++;
		}
	}
	return nonPrintable / Math.max(1, n) > 0.3;
}

function listAllFiles(
	root: string,
	extraFilter: (rel: string, isDir?: boolean) => boolean
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
			let lst: fs.Stats | undefined;
			try {
				lst = fs.lstatSync(abs);
			} catch {
				continue;
			}
			if (lst.isSymbolicLink()) {
				continue;
			}
			const isDir = lst.isDirectory();
			const rel = path.relative(root, abs);
			const posix = toPosix(rel);
			if (!extraFilter(posix, isDir)) {
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
	const filter = (posixRel: string, isDir?: boolean) => {
		// Force-exclude the checkpoints directory to avoid recursive snapshots.
		if (posixRel.startsWith('.wraith/checkpoints/')) {
			return false;
		}
		return baseFilter(posixRel, isDir);
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

function checkpointsRoot(): string {
	return realCheckpointsDir();
}

export function listCheckpointDirs(): string[] {
	try {
		return fs
			.readdirSync(checkpointsRoot(), { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => path.join(checkpointsRoot(), d.name));
	} catch {
		return [];
	}
}

export function findCheckpointDirByPrefix(prefix: string): string {
	const dir = checkpointsRoot();
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
	// Exact first, then prefix
	const exact = entries.find((e) => e === prefix);
	if (exact) {
		return path.join(dir, exact);
	}
	const match = entries.find((e) => e.startsWith(prefix));
	if (!match) {
		throw new Error(`Checkpoint not found for: ${prefix}`);
	}
	return path.join(dir, match);
}

export function loadCheckpointManifest(idOrPrefix: string): {
	dir: string;
	manifest: CheckpointManifestV1;
} {
	const cdir = findCheckpointDirByPrefix(idOrPrefix);
	const manifestPath = path.join(cdir, 'manifest.json');
	const manifest = JSON.parse(
		fs.readFileSync(manifestPath, 'utf8')
	) as CheckpointManifestV1;
	if (
		manifest.version !== 1 ||
		!manifest.meta ||
		!Array.isArray(manifest.files)
	) {
		throw new Error(`Invalid checkpoint manifest: ${manifestPath}`);
	}
	return { dir: cdir, manifest };
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
	const { dir: cdir, manifest } = loadCheckpointManifest(idOrPrefix);
	const files = manifest.files;

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
			checkpointId: manifest.meta.id,
			label: manifest.meta.label,
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
			checkpointsRoot(),
			'_restore-backups',
			`${manifest.meta.id}-${randId(3)}`
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
		checkpointId: manifest.meta.id,
		label: manifest.meta.label,
		restored: files.length,
		overwrites,
		backupDir,
	});
}

/** Utilities exported for diffing logic */
export function snapshotWorktree(rootDir: string): {
	files: Map<string, { size: number; content: Buffer; binary: boolean }>;
} {
	const { merged } = loadConfig();
	const baseFilter = buildIgnoreFilterFromConfig(rootDir, merged);
	const filter = (posixRel: string, isDir?: boolean) => {
		if (posixRel.startsWith('.wraith/checkpoints/')) {
			return false;
		}
		return baseFilter(posixRel, isDir);
	};
	const absFiles = listAllFiles(rootDir, filter);
	const map = new Map<
		string,
		{ size: number; content: Buffer; binary: boolean }
	>();
	for (const abs of absFiles) {
		const rel = path.relative(rootDir, abs);
		const posix = toPosix(rel);
		const buf = fs.readFileSync(abs);
		map.set(posix, {
			size: buf.length,
			content: buf,
			binary: isBinaryBuffer(buf),
		});
	}
	return { files: map };
}

export function snapshotFromCheckpoint(checkpointDirOrPrefix: string): {
	id: string;
	label?: string;
	files: Map<string, { size: number; content: Buffer; binary: boolean }>;
} {
	const { dir, manifest } = loadCheckpointManifest(checkpointDirOrPrefix);
	const filesRoot = path.join(dir, 'files');
	const map = new Map<
		string,
		{ size: number; content: Buffer; binary: boolean }
	>();
	for (const f of manifest.files) {
		const abs = path.join(filesRoot, f.path.split('/').join(path.sep));
		const buf = fs.readFileSync(abs);
		map.set(f.path, { size: buf.length, content: buf, binary: false }); // binary flag recomputed by consumer if needed
	}
	return { id: manifest.meta.id, label: manifest.meta.label, files: map };
}
