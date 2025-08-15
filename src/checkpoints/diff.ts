import {
	loadCheckpointManifest,
	snapshotFromCheckpoint,
	snapshotWorktree,
} from '@checkpoints/store';
import { createTwoFilesPatch } from 'diff';

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

export type DiffStatus =
	| 'added'
	| 'removed'
	| 'modified'
	| 'unchanged'
	| 'binary_modified';

export type DiffEntry = {
	path: string;
	status: DiffStatus;
	oldSize?: number;
	newSize?: number;
	patch?: string; // unified diff for text files
};

export type CheckpointDiffResult = {
	fromId: string;
	fromLabel?: string;
	toId: string;
	toLabel?: string;
	entries: DiffEntry[];
	stats: {
		added: number;
		removed: number;
		modified: number;
		unchanged: number;
		binary: number;
	};
};

export async function computeCheckpointDiff(
	rootDir: string,
	from: string,
	to: string,
	opts: { maxPatchLines?: number } = {}
): Promise<CheckpointDiffResult> {
	const maxLines = Math.max(10, opts.maxPatchLines ?? 500);

	// Build snapshots
	const leftSnap =
		from === 'worktree'
			? { id: 'worktree', label: undefined, ...snapshotWorktree(rootDir) }
			: snapshotFromCheckpoint(from);

	const rightSnap =
		to === 'worktree'
			? { id: 'worktree', label: undefined, ...snapshotWorktree(rootDir) }
			: snapshotFromCheckpoint(to);

	// Fill labels for checkpoint snapshots
	const leftMeta =
		from === 'worktree'
			? { id: 'worktree', label: undefined }
			: loadCheckpointManifest(from).manifest.meta;
	const rightMeta =
		to === 'worktree'
			? { id: 'worktree', label: undefined }
			: loadCheckpointManifest(to).manifest.meta;

	const left = leftSnap.files;
	const right = rightSnap.files;

	const allPaths = new Set<string>([...left.keys(), ...right.keys()]);
	const entries: DiffEntry[] = [];

	let added = 0,
		removed = 0,
		modified = 0,
		unchanged = 0,
		binary = 0;

	for (const p of Array.from(allPaths).sort()) {
		const l = left.get(p);
		const r = right.get(p);
		if (l && !r) {
			removed++;
			entries.push({
				path: p,
				status: 'removed',
				oldSize: l.size,
				newSize: 0,
				patch: textPatch(p, l.content, Buffer.alloc(0), maxLines),
			});
			continue;
		}
		if (!l && r) {
			added++;
			entries.push({
				path: p,
				status: 'added',
				oldSize: 0,
				newSize: r.size,
				patch: textPatch(p, Buffer.alloc(0), r.content, maxLines),
			});
			continue;
		}
		if (!(l && r)) {
			continue; // impossible
		}

		// Both sides present: compare
		if (l.size === r.size && l.content.equals(r.content)) {
			unchanged++;
			entries.push({
				path: p,
				status: 'unchanged',
				oldSize: l.size,
				newSize: r.size,
			});
			continue;
		}
		// Detect binaries
		const lbin = l.binary ?? isBinaryBuffer(l.content);
		const rbin = r.binary ?? isBinaryBuffer(r.content);
		if (lbin || rbin) {
			binary++;
			entries.push({
				path: p,
				status: 'binary_modified',
				oldSize: l.size,
				newSize: r.size,
			});
			continue;
		}
		// Text diff
		modified++;
		const patch = textPatch(p, l.content, r.content, maxLines);
		entries.push({
			path: p,
			status: 'modified',
			oldSize: l.size,
			newSize: r.size,
			patch,
		});
	}

	return await Promise.resolve({
		fromId: leftMeta.id,
		fromLabel: leftMeta.label,
		toId: rightMeta.id,
		toLabel: rightMeta.label,
		entries,
		stats: { added, removed, modified, unchanged, binary },
	});
}

function toText(buf: Buffer): string {
	return buf.toString('utf8');
}

function capLines(s: string, maxLines: number): string {
	const lines = s.split('\n');
	if (lines.length <= maxLines) {
		return s;
	}
	return [
		...lines.slice(0, maxLines),
		`... (trimmed to ${maxLines} lines)`,
	].join('\n');
}

function textPatch(
	pathRel: string,
	a: Buffer,
	b: Buffer,
	maxLines: number
): string {
	// Treat empty buffer as empty text for added/removed
	const aText = toText(a);
	const bText = toText(b);
	const patch = createTwoFilesPatch(
		pathRel,
		pathRel,
		aText,
		bText,
		'before',
		'after',
		{ context: 3 }
	);
	return capLines(patch, maxLines);
}
