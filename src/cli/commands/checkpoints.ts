/** biome-ignore-all lint/suspicious/noConsole: CLI */
import path from 'node:path';
import {
	type CheckpointDiffResult,
	computeCheckpointDiff,
} from '@checkpoints/diff';
import { createCheckpoint, restoreCheckpoint } from '@checkpoints/store';
import type { Command } from 'commander';

export function registerCheckpointsCommand(program: Command): void {
	const cmd = program
		.command('checkpoint')
		.description('Manage project checkpoints (create/restore/diff)');

	cmd.command('create')
		.description('Create a new checkpoint snapshot')
		.option('--label <text>', 'Optional label for the checkpoint')
		.option('--json', 'Emit JSON')
		.action(async (flags: { label?: string; json?: boolean }) => {
			const label =
				typeof flags.label === 'string' && flags.label.trim().length
					? flags.label
					: undefined;
			const root = process.cwd();
			const res = await createCheckpoint(root, { label });
			if (flags.json) {
				process.stdout.write(
					`${JSON.stringify(
						{
							ok: true,
							checkpoint: res.meta,
							dir: res.dir,
							manifest: path.relative(root, res.manifestPath),
						},
						null,
						2
					)}\n`
				);
				return;
			}
			console.log(
				`Created checkpoint ${res.meta.id}${
					res.meta.label ? ` (${res.meta.label})` : ''
				}`
			);
			console.log(
				`Files: ${res.meta.files}, bytes: ${res.meta.bytes}, dir: ${path.relative(root, res.dir)}`
			);
		});

	cmd.command('restore <idOrPrefix>')
		.description('Restore files from a checkpoint')
		.option('--dry-run', 'Do not write files; print changes only')
		.option('--force', 'Overwrite existing files without prompt')
		.option('--json', 'Emit JSON')
		.action(
			async (
				idOrPrefix: string,
				flags: { json?: boolean; force?: boolean; 'dry-run'?: boolean }
			) => {
				const root = process.cwd();
				const dryRun = flags['dry-run'] === true;
				const force = flags.force === true;
				const out = await restoreCheckpoint(root, idOrPrefix, {
					dryRun,
					force,
				});
				if (flags.json) {
					process.stdout.write(
						`${JSON.stringify({ ok: true, ...out }, null, 2)}\n`
					);
					return;
				}
				if (dryRun) {
					console.log(
						`[dry-run] Would restore ${out.restored} files from ${out.checkpointId} (${out.label ?? 'no label'})`
					);
					if (out.overwrites?.length) {
						console.log(
							`[dry-run] Would overwrite ${out.overwrites.length} existing file(s):`
						);
						for (const f of out.overwrites.slice(0, 20)) {
							console.log(`  - ${f}`);
						}
						if (out.overwrites.length > 20) {
							console.log(
								`  … +${out.overwrites.length - 20} more (use --json to see all)`
							);
						}
					}
					return;
				}
				console.log(
					`Restored ${out.restored} files from checkpoint ${out.checkpointId}${
						out.label ? ` (${out.label})` : ''
					}`
				);
				if (out.backupDir) {
					console.log(
						`Backups saved to: ${path.relative(root, out.backupDir)}`
					);
				}
			}
		);

	cmd.command('diff <from> <to>')
		.description(
			'Show a unified diff between two checkpoints (or vs worktree). Use "worktree" as one side to compare the current project.'
		)
		.option('--json', 'Emit JSON')
		.option('--summary', 'Print a short summary instead of full patches')
		.option(
			'--max-lines <n>',
			'Max lines of patch output per file (default: 500)',
			(v) => Number.parseInt(v, 10),
			500
		)
		.action(
			async (
				from: string,
				to: string,
				flags: {
					json?: boolean;
					summary?: boolean;
					'max-lines'?: number;
				}
			) => {
				const root = process.cwd();
				const res: CheckpointDiffResult = await computeCheckpointDiff(
					root,
					from,
					to,
					{ maxPatchLines: flags['max-lines'] ?? 500 }
				);

				if (flags.json) {
					process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
					return;
				}

				// human rendering
				const header = `Diff ${res.fromId}${res.fromLabel ? ` (${res.fromLabel})` : ''} → ${res.toId}${res.toLabel ? ` (${res.toLabel})` : ''}`;
				console.log(header);
				console.log(
					`Files: +${res.stats.added}  -${res.stats.removed}  ~${res.stats.modified}  (unchanged ${res.stats.unchanged})  binaries ${res.stats.binary}`
				);
				if (flags.summary) {
					for (const e of res.entries) {
						const mark =
							e.status === 'added'
								? '+'
								: e.status === 'removed'
									? '-'
									: e.status === 'modified'
										? '~'
										: e.status === 'binary_modified'
											? 'B'
											: ' ';
						console.log(`${mark} ${e.path}`);
					}
					return;
				}
				for (const e of res.entries) {
					if (e.status === 'unchanged') {
						continue;
					}
					if (e.status === 'binary_modified') {
						console.log(`Binary modified: ${e.path}`);
						continue;
					}
					if (e.status === 'added') {
						console.log(`Added: ${e.path}`);
						if (e.patch) {
							console.log(e.patch.trimEnd());
						}
						continue;
					}
					if (e.status === 'removed') {
						console.log(`Removed: ${e.path}`);
						if (e.patch) {
							console.log(e.patch.trimEnd());
						}
						continue;
					}
					// modified text
					console.log(
						e.patch ? e.patch.trimEnd() : `Modified: ${e.path}`
					);
				}
			}
		);
}
