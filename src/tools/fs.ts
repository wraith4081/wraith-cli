import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { childLogger } from '@obs/logger';
import { ToolPermissionError } from '@tools/errors';
import type { ToolRegistry } from '@tools/registry';
import type { ToolHandler, ToolSpec } from '@tools/types';
import { applyPatch, createTwoFilesPatch } from 'diff';

const log = childLogger({ mod: 'tools.fs' });

type Json = Record<string, unknown>;

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

function sha256(buf: Buffer): string {
	const h = crypto.createHash('sha256');
	h.update(buf);
	return h.digest('hex');
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

function ensureDir(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

function resolveInSandbox(cwd: string, rel: string): string {
	const abs = path.resolve(cwd, rel);
	const relFromRoot = path.relative(cwd, abs);
	// outside root -> '../' prefix or absolute
	if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) {
		log.warn({
			msg: 'fs.path-escape-detected',
			cwd,
			requested: rel,
			resolved: abs,
		});
		throw new ToolPermissionError('fs', `Path escapes sandbox: ${rel}`);
	}
	return abs;
}

function guardSymlinkWrites(absPath: string, op: string): void {
	try {
		const st = fs.lstatSync(absPath);
		if (st.isSymbolicLink()) {
			// resolve and ensure still inside parent dir
			const real = fs.realpathSync(absPath);
			const base = fs.realpathSync(path.dirname(absPath));
			const rel = path.relative(base, real);
			if (rel.startsWith('..') || path.isAbsolute(rel)) {
				log.warn({
					msg: 'fs.symlink-outside-sandbox',
					op,
					target: toPosix(absPath),
					real: toPosix(real),
				});
				throw new ToolPermissionError(
					`fs.${op}`,
					`Refusing to follow symlink outside sandbox: ${toPosix(absPath)} -> ${toPosix(real)}`
				);
			}
			// more conservative: disallow writing via symlink entirely
			log.warn({
				msg: 'fs.symlink-write-denied',
				op,
				target: toPosix(absPath),
			});
			throw new ToolPermissionError(
				`fs.${op}`,
				`Refusing to write via symlink: ${toPosix(absPath)}`
			);
		}
	} catch {
		// path may not exist yet; check parent dir realpath
		const parent = fs.realpathSync(path.dirname(absPath));
		const rel = path.relative(parent, absPath);
		if (rel.startsWith('..') || path.isAbsolute(rel)) {
			log.warn({
				msg: 'fs.parent-escape-detected',
				op,
				parent: toPosix(parent),
				target: toPosix(absPath),
			});
			throw new ToolPermissionError(
				`fs.${op}`,
				`Parent directory escapes sandbox: ${toPosix(absPath)}`
			);
		}
	}
}

function readTextFile(
	absPath: string,
	maxBytes: number
): {
	content?: string;
	buf?: Buffer;
	binary: boolean;
	bytes: number;
	truncated: boolean;
} {
	if (!fs.existsSync(absPath)) {
		return { binary: false, bytes: 0, truncated: false };
	}
	const st = fs.statSync(absPath);
	const size = st.size;
	const readBytes = Math.min(size, maxBytes);
	const buf = fs.readFileSync(absPath).subarray(0, readBytes);
	const binary = isBinaryBuffer(buf);
	if (binary) {
		return { binary: true, bytes: size, truncated: size > maxBytes, buf };
	}
	return {
		binary: false,
		bytes: size,
		truncated: size > maxBytes,
		content: buf.toString('utf8'),
		buf,
	};
}

const FsListSpec: ToolSpec = {
	name: 'fs.list',
	title: 'List directory',
	description: 'List entries under a directory within the sandbox.',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			path: { type: 'string', minLength: 1 },
			recursive: { type: 'boolean', default: false },
			includeFiles: { type: 'boolean', default: true },
			includeDirs: { type: 'boolean', default: true },
			maxEntries: { type: 'integer', minimum: 1, default: 10_000 },
		},
		required: ['path'],
	},
};

const FsReadSpec: ToolSpec = {
	name: 'fs.read',
	title: 'Read file',
	description: 'Read a text file within the sandbox (binary-safe metadata).',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			path: { type: 'string', minLength: 1 },
			maxBytes: { type: 'integer', minimum: 1, default: 1_048_576 },
		},
		required: ['path'],
	},
};

const FsWriteSpec: ToolSpec = {
	name: 'fs.write',
	title: 'Write file (with diff preview)',
	description:
		'Write text content to a file. Provides unified diff preview. Blocks binary/symlink edits.',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			path: { type: 'string', minLength: 1 },
			content: { type: 'string' },
			create: { type: 'boolean', default: true },
			overwrite: { type: 'boolean', default: true },
			preview: { type: 'boolean', default: false },
			maxBytes: { type: 'integer', minimum: 1, default: 5_242_880 },
		},
		required: ['path', 'content'],
	},
};

const FsAppendSpec: ToolSpec = {
	name: 'fs.append',
	title: 'Append to file (with diff preview)',
	description:
		'Append text to a file. Provides unified diff preview. Blocks binary/symlink edits.',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			path: { type: 'string', minLength: 1 },
			content: { type: 'string' },
			create: { type: 'boolean', default: true },
			preview: { type: 'boolean', default: false },
			maxBytes: { type: 'integer', minimum: 1, default: 5_242_880 },
		},
		required: ['path', 'content'],
	},
};

const FsSearchSpec: ToolSpec = {
	name: 'fs.search',
	title: 'Search text',
	description:
		'Search for a string or regex across files under a directory within the sandbox.',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			root: { type: 'string', default: '.' },
			paths: {
				type: 'array',
				items: { type: 'string' },
				default: [] as string[],
			},
			query: { type: 'string', minLength: 1 },
			regex: { type: 'boolean', default: false },
			caseSensitive: { type: 'boolean', default: false },
			maxMatches: { type: 'integer', minimum: 1, default: 500 },
			maxFileBytes: { type: 'integer', minimum: 1, default: 1_048_576 },
		},
		required: ['query'],
	},
};

const FsPatchSpec: ToolSpec = {
	name: 'fs.patch',
	title: 'Apply unified diff patch',
	description:
		'Apply a unified diff (patch) to a file. Provides preview capability. Blocks binary/symlink edits.',
	requiredPermissions: ['fs'],
	paramsSchema: {
		type: 'object',
		additionalProperties: false,
		properties: {
			path: { type: 'string', minLength: 1 },
			patch: { type: 'string', minLength: 1 },
			preview: { type: 'boolean', default: false },
			maxBytes: { type: 'integer', minimum: 1, default: 5_242_880 },
		},
		required: ['path', 'patch'],
	},
};

const listHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as {
		path: string;
		recursive?: boolean;
		includeFiles?: boolean;
		includeDirs?: boolean;
		maxEntries?: number;
	};
	const base = resolveInSandbox(ctx.cwd, p.path);
	const recursive = p.recursive ?? false;
	const includeFiles = p.includeFiles ?? true;
	const includeDirs = p.includeDirs ?? true;
	const maxEntries = Math.max(1, p.maxEntries ?? 10_000);

	log.debug({
		msg: 'fs.list.start',
		base: toPosix(path.relative(ctx.cwd, base)),
		recursive,
		includeFiles,
		includeDirs,
		maxEntries,
	});

	const out: Array<{
		path: string;
		type: 'file' | 'dir';
		size: number;
		mtimeMs: number;
	}> = [];

	function walk(dir: string) {
		const entries = fs.readdirSync(dir, { withFileTypes: true });
		for (const e of entries) {
			const abs = path.join(dir, e.name);
			const st = fs.statSync(abs);
			const type = e.isDirectory()
				? 'dir'
				: e.isFile()
					? 'file'
					: undefined;
			if (!type) {
				continue;
			}
			if (type === 'dir' && includeDirs) {
				out.push({
					path: toPosix(path.relative(ctx.cwd, abs)),
					type,
					size: 0,
					mtimeMs: st.mtimeMs,
				});
			}
			if (type === 'file' && includeFiles) {
				out.push({
					path: toPosix(path.relative(ctx.cwd, abs)),
					type,
					size: st.size,
					mtimeMs: st.mtimeMs,
				});
			}
			if (out.length >= maxEntries) {
				return;
			}
			if (recursive && e.isDirectory()) {
				walk(abs);
			}
		}
	}

	const st = fs.statSync(base);
	if (st.isDirectory()) {
		walk(base);
	} else if (st.isFile()) {
		out.push({
			path: toPosix(path.relative(ctx.cwd, base)),
			type: 'file',
			size: st.size,
			mtimeMs: st.mtimeMs,
		});
	}
	const res = {
		entries: out.slice(0, maxEntries),
		truncated: out.length > maxEntries,
	};
	log.debug({
		msg: 'fs.list.done',
		count: res.entries.length,
		truncated: res.truncated,
		ms: Date.now() - t0,
	});
	return res;
};

const readHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as { path: string; maxBytes?: number };
	const abs = resolveInSandbox(ctx.cwd, p.path);
	const maxBytes = Math.max(1, p.maxBytes ?? 1_048_576);

	log.debug({
		msg: 'fs.read.start',
		path: toPosix(path.relative(ctx.cwd, abs)),
		maxBytes,
	});

	const r = readTextFile(abs, maxBytes);
	const meta = {
		path: toPosix(path.relative(ctx.cwd, abs)),
		bytes: r.bytes,
		truncated: r.truncated,
	};
	const out = r.binary
		? ({
				...meta,
				binary: true,
				sha256: r.buf ? sha256(r.buf) : undefined,
			} as Json)
		: ({
				...meta,
				binary: false,
				content: r.content ?? '',
				sha256: r.buf ? sha256(r.buf) : undefined,
			} as Json);

	log.debug({
		msg: 'fs.read.done',
		path: meta.path,
		binary: r.binary,
		bytes: r.bytes,
		truncated: r.truncated,
		ms: Date.now() - t0,
	});
	return out;
};

function prepareWrite(
	abs: string,
	content: string,
	maxBytes: number
): {
	oldText: string;
	oldExists: boolean;
	oldBinary: boolean;
	diff: string;
} {
	const r = readTextFile(abs, maxBytes);
	const oldExists = fs.existsSync(abs);
	const oldBinary = r.binary;
	const oldText = r.binary ? '' : (r.content ?? '');
	const diff = createTwoFilesPatch(
		abs,
		abs,
		oldText,
		content,
		'before',
		'after'
	);
	return { oldText, oldExists, oldBinary, diff };
}

const writeHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as {
		path: string;
		content: string;
		create?: boolean;
		overwrite?: boolean;
		preview?: boolean;
		maxBytes?: number;
	};
	const abs = resolveInSandbox(ctx.cwd, p.path);
	guardSymlinkWrites(abs, 'write');

	const create = p.create ?? true;
	const overwrite = p.overwrite ?? true;
	const preview = p.preview ?? false;
	const maxBytes = Math.max(1, p.maxBytes ?? 5_242_880);

	const exists = fs.existsSync(abs);
	if (exists && !overwrite) {
		log.warn({
			msg: 'fs.write.overwrite-denied',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.write',
			`Refusing to overwrite existing file: ${toPosix(p.path)}`
		);
	}
	if (!(exists || create)) {
		log.warn({
			msg: 'fs.write.create-denied',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.write',
			`Refusing to create new file: ${toPosix(p.path)}`
		);
	}

	const { oldExists, oldBinary, diff } = prepareWrite(
		abs,
		p.content,
		maxBytes
	);
	if (oldExists && oldBinary) {
		log.warn({
			msg: 'fs.write.binary-refused',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.write',
			`Target is binary; refusing to edit: ${toPosix(p.path)}`
		);
	}

	const diffBytes = Buffer.byteLength(diff, 'utf8');
	const diffLines = diff.split('\n').length;

	if (preview) {
		log.debug({
			msg: 'fs.write.preview',
			path: toPosix(path.relative(ctx.cwd, abs)),
			diffBytes,
			diffLines,
			ms: Date.now() - t0,
		});
		return {
			preview: true,
			path: toPosix(path.relative(ctx.cwd, abs)),
			diff,
		} as Json;
	}

	ensureDir(path.dirname(abs));
	fs.writeFileSync(abs, p.content, 'utf8');
	log.info({
		msg: 'fs.write.ok',
		path: toPosix(path.relative(ctx.cwd, abs)),
		bytes: Buffer.byteLength(p.content, 'utf8'),
		diffBytes,
		diffLines,
		ms: Date.now() - t0,
	});
	return {
		written: true,
		bytes: Buffer.byteLength(p.content, 'utf8'),
		path: toPosix(path.relative(ctx.cwd, abs)),
		diff,
	} as Json;
};

const appendHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as {
		path: string;
		content: string;
		create?: boolean;
		preview?: boolean;
		maxBytes?: number;
	};
	const abs = resolveInSandbox(ctx.cwd, p.path);
	guardSymlinkWrites(abs, 'append');

	const create = p.create ?? true;
	const preview = p.preview ?? false;
	const maxBytes = Math.max(1, p.maxBytes ?? 5_242_880);

	const exists = fs.existsSync(abs);
	if (!(exists || create)) {
		log.warn({
			msg: 'fs.append.create-denied',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.append',
			`Refusing to create new file: ${toPosix(p.path)}`
		);
	}

	const r = readTextFile(abs, maxBytes);
	if (exists && r.binary) {
		log.warn({
			msg: 'fs.append.binary-refused',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.append',
			`Target is binary; refusing to edit: ${toPosix(p.path)}`
		);
	}
	const oldText = r.binary ? '' : (r.content ?? '');
	const newText = oldText + p.content;
	const diff = createTwoFilesPatch(
		abs,
		abs,
		oldText,
		newText,
		'before',
		'after'
	);

	const diffBytes = Buffer.byteLength(diff, 'utf8');
	const diffLines = diff.split('\n').length;

	if (preview) {
		log.debug({
			msg: 'fs.append.preview',
			path: toPosix(path.relative(ctx.cwd, abs)),
			diffBytes,
			diffLines,
			ms: Date.now() - t0,
		});
		return {
			preview: true,
			path: toPosix(path.relative(ctx.cwd, abs)),
			diff,
		} as Json;
	}

	ensureDir(path.dirname(abs));
	fs.writeFileSync(abs, newText, 'utf8');
	log.info({
		msg: 'fs.append.ok',
		path: toPosix(path.relative(ctx.cwd, abs)),
		appendedBytes: Buffer.byteLength(p.content, 'utf8'),
		diffBytes,
		diffLines,
		ms: Date.now() - t0,
	});
	return {
		appended: true,
		bytes: Buffer.byteLength(p.content, 'utf8'),
		path: toPosix(path.relative(ctx.cwd, abs)),
		diff,
	} as Json;
};

const searchHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as {
		root?: string;
		paths?: string[];
		query: string;
		regex?: boolean;
		caseSensitive?: boolean;
		maxMatches?: number;
		maxFileBytes?: number;
	};
	const rootAbs = resolveInSandbox(ctx.cwd, p.root ?? '.');
	const searchPaths = (p.paths ?? []).length ? p.paths : ['.'];
	const maxMatches = Math.max(1, p.maxMatches ?? 500);
	const maxFileBytes = Math.max(1, p.maxFileBytes ?? 1_048_576);

	log.debug({
		msg: 'fs.search.start',
		root: toPosix(path.relative(ctx.cwd, rootAbs)),
		paths: searchPaths,
		regex: p.regex ?? false,
		caseSensitive: p.caseSensitive ?? false,
		maxMatches,
		maxFileBytes,
		queryLen: p.query?.length ?? 0,
	});

	const results: Array<{
		file: string;
		line: number;
		column: number;
		match: string;
		lineText: string;
	}> = [];
	const needle = p.query;
	const re =
		p.regex === true
			? new RegExp(needle, p.caseSensitive ? 'g' : 'gi')
			: null;
	const incr = (fileAbs: string) => {
		const r = readTextFile(fileAbs, maxFileBytes);
		if (r.binary || !r.content) {
			return;
		}
		const lines = r.content.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (results.length >= maxMatches) {
				return;
			}
			const line = lines[i];
			if (re) {
				let m: RegExpExecArray | null;
				const rx = new RegExp(
					re.source,
					re.flags.includes('g') ? re.flags : `${re.flags}g`
				);
				m = rx.exec(line);
				if (m) {
					results.push({
						file: toPosix(path.relative(ctx.cwd, fileAbs)),
						line: i + 1,
						column: Math.max(1, (m.index ?? 0) + 1),
						match: m[0] ?? '',
						lineText: line,
					});
				}
			} else {
				const hay = p.caseSensitive ? line : line.toLowerCase();
				const ndl = p.caseSensitive ? needle : needle.toLowerCase();
				const idx = hay.indexOf(ndl);
				if (idx >= 0) {
					results.push({
						file: toPosix(path.relative(ctx.cwd, fileAbs)),
						line: i + 1,
						column: idx + 1,
						match: line.slice(idx, idx + ndl.length),
						lineText: line,
					});
				}
			}
		}
	};

	function walk(startAbs: string) {
		const st = fs.statSync(startAbs);
		if (st.isFile()) {
			incr(startAbs);
			return;
		}
		if (!st.isDirectory()) {
			return;
		}
		const entries = fs.readdirSync(startAbs, { withFileTypes: true });
		for (const e of entries) {
			if (results.length >= maxMatches) {
				return;
			}
			const abs = path.join(startAbs, e.name);
			try {
				const lst = fs.lstatSync(abs);
				if (lst.isSymbolicLink()) {
					continue; // skip symlinks
				}
			} catch {
				continue;
			}
			if (e.isDirectory()) {
				walk(abs);
			} else if (e.isFile()) {
				incr(abs);
			}
		}
	}

	for (const pth of searchPaths ?? []) {
		const abs = resolveInSandbox(rootAbs, pth);
		walk(abs);
		if (results.length >= maxMatches) {
			break;
		}
	}

	const res = { matches: results, truncated: results.length >= maxMatches };
	log.debug({
		msg: 'fs.search.done',
		matches: res.matches.length,
		truncated: res.truncated,
		ms: Date.now() - t0,
	});
	return res;
};

const patchHandler: ToolHandler = (params, ctx) => {
	const t0 = Date.now();
	const p = params as {
		path: string;
		patch: string;
		preview?: boolean;
		maxBytes?: number;
	};
	const abs = resolveInSandbox(ctx.cwd, p.path);
	guardSymlinkWrites(abs, 'patch');

	const maxBytes = Math.max(1, p.maxBytes ?? 5_242_880);
	const r = readTextFile(abs, maxBytes);
	if (r.binary) {
		log.warn({
			msg: 'fs.patch.binary-refused',
			path: toPosix(path.relative(ctx.cwd, abs)),
		});
		throw new ToolPermissionError(
			'fs.patch',
			`Target is binary; refusing to edit: ${toPosix(p.path)}`
		);
	}
	const oldText = r.content ?? '';
	let applied: string | false;

	try {
		applied = applyPatch(oldText, p.patch);
	} catch {
		applied = false;
	}

	if (applied === false) {
		log.warn({
			msg: 'fs.patch.apply-failed',
			path: toPosix(path.relative(ctx.cwd, abs)),
			preview: p.preview === true,
		});
		if (p.preview === true) {
			return {
				preview: true,
				path: toPosix(path.relative(ctx.cwd, abs)),
				error: 'Invalid or unsupported patch format',
			} as Json;
		}

		return {
			applied: false,
			error: 'Invalid or unsupported patch format',
		} as Json;
	}

	if (p.preview === true) {
		const diff = createTwoFilesPatch(
			abs,
			abs,
			oldText,
			applied,
			'before',
			'after'
		);
		log.debug({
			msg: 'fs.patch.preview',
			path: toPosix(path.relative(ctx.cwd, abs)),
			diffBytes: Buffer.byteLength(diff, 'utf8'),
			diffLines: diff.split('\n').length,
			ms: Date.now() - t0,
		});
		return {
			preview: true,
			path: toPosix(path.relative(ctx.cwd, abs)),
			diff,
		} as Json;
	}

	ensureDir(path.dirname(abs));
	fs.writeFileSync(abs, applied, 'utf8');
	log.info({
		msg: 'fs.patch.applied',
		path: toPosix(path.relative(ctx.cwd, abs)),
		ms: Date.now() - t0,
	});
	return {
		applied: true,
		path: toPosix(path.relative(ctx.cwd, abs)),
	} as Json;
};

export function registerFsTools(reg: ToolRegistry): void {
	reg.register(FsListSpec, listHandler);
	reg.register(FsReadSpec, readHandler);
	reg.register(FsWriteSpec, writeHandler);
	reg.register(FsAppendSpec, appendHandler);
	reg.register(FsSearchSpec, searchHandler);
	reg.register(FsPatchSpec, patchHandler);
}
