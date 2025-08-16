/** biome-ignore-all lint/suspicious/noConsole: tbd */
import { getLogger } from '@obs/logger';
import { selfUpdate } from '@util/self-update';
import type { Command } from 'commander';

export function registerSelfUpdateCommand(program: Command) {
	program
		.command('self-update')
		.description(
			'Update the wraith CLI to the latest GitHub release (Bun-compiled binary only).'
		)
		.option(
			'--repo <owner/repo>',
			'GitHub repo (override WRAITH_REPO)',
			process.env.WRAITH_REPO
		)
		.option(
			'--dry-run',
			'Download but do not replace the current binary',
			false
		)
		.action(async (opts: { repo?: string; dryRun?: boolean }) => {
			const log = getLogger();
			try {
				const res = await selfUpdate({
					repo: opts.repo,
					dryRun: opts.dryRun,
				});
				log.info({ msg: 'self-update', ...res });
				console.log(res.message);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				log.error({ msg: 'self-update.error', error: msg });
				console.error(`Self-update failed: ${msg}`);
				process.exitCode = 1;
			}
		});
}
