/** biome-ignore-all lint/suspicious/noConsole: CLI */

import path from 'node:path';
import { createCheckpoint, restoreCheckpoint } from '@checkpoints/store';
import type { Command } from 'commander';

export function registerCheckpointsCommand(program: Command) {
	const createAction = async (flags: Record<string, unknown>) => {
		const label =
			typeof flags.label === 'string' && flags.label.trim().length
				? (flags.label as string)
				: undefined;
		const root = process.cwd();
		const res = await createCheckpoint(root, { label });
		if (flags.json === true) {
			process.stdout.write(
				`${JSON.stringify({ ok: true, checkpoint: res.meta, dir: res.dir, manifest: path.relative(root, res.manifestPath) }, null, 2)}\n`
			);
			return;
		}
		console.log(
			`Created checkpoint ${res.meta.id}${res.meta.label ? ` (${res.meta.label})` : ''}`
		);
		console.log(
			`Files: ${res.meta.files}, bytes: ${res.meta.bytes}, dir: ${path.relative(root, res.dir)}`
		);
	};

	const restoreAction = async (
		idOrPrefix: string,
		flags: Record<string, unknown>
	) => {
		const root = process.cwd();
		const dryRun = flags['dry-run'] === true;
		const force = flags.force === true;
		const out = await restoreCheckpoint(root, idOrPrefix, {
			dryRun,
			force,
		});
		if (flags.json === true) {
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
			`Restored ${out.restored} files from checkpoint ${out.checkpointId}${out.label ? ` (${out.label})` : ''}`
		);
		if (out.backupDir) {
			console.log(
				`Backups saved to: ${path.relative(root, out.backupDir)}`
			);
		}
	};

	const cmd = program
		.command('checkpoint')
		.description('Manage project checkpoints (create/restore)');
	cmd.command('create')
		.description('Create a new checkpoint snapshot')
		.option('--label <text>', 'Optional label for the checkpoint')
		.option('--json', 'Emit JSON')
		.action(async (flags: Record<string, unknown>) => {
			await createAction(flags);
		});
	cmd.command('restore <idOrPrefix>')
		.description('Restore files from a checkpoint')
		.option('--dry-run', 'Do not write files; print changes only')
		.option('--force', 'Overwrite existing files without prompt')
		.option('--json', 'Emit JSON')
		.action(async (id: string, flags: Record<string, unknown>) => {
			await restoreAction(id, flags);
		});
}
