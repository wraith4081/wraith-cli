/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { type Period, readAllMetrics, summarize } from '@obs/metrics';
import { getProjectWraithDir } from '@store/config';
import type { Command } from 'commander';

export function registerUsageCommand(program: Command) {
	const cmd = program
		.command('usage')
		.description('Usage analytics (local only)');

	cmd.command('show')
		.description('Show local usage summaries')
		.option('--json', 'output JSON')
		.option('--by <period>', 'grouping: day|week|project', 'day')
		.action((opts: { json?: boolean; by?: string }) => {
			const by = (opts.by as Period) ?? 'day';
			const events = readAllMetrics(process.cwd());
			const rows = summarize(events, by);
			if (opts.json) {
				console.log(
					JSON.stringify(
						{
							by,
							projectDir: getProjectWraithDir(process.cwd()),
							rows,
						},
						null,
						2
					)
				);
				return;
			}
			if (rows.length === 0) {
				console.log(
					'No local analytics found. (Analytics is disabled by default.)'
				);
				return;
			}
			// pretty table (simple)
			const header = [
				'Key',
				'Asks',
				'Chat',
				'Tools',
				'Errors',
				'Tok In',
				'Tok Out',
				'Tok Tot',
				'Avg ms',
			];
			console.log(header.join('\t'));
			for (const r of rows) {
				console.log(
					[
						r.key,
						r.asks,
						r.chatTurns,
						r.toolCalls,
						r.errors,
						r.tokensIn,
						r.tokensOut,
						r.tokensTotal,
						r.avgLatencyMs ?? '-',
					].join('\t')
				);
			}
		});
}
