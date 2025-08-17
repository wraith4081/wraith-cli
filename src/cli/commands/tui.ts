import type { Command } from 'commander';

type TuiOpts = {
	model?: string;
	profile?: string;
	system?: string;
	instructions?: string;
};

export function registerTuiCommand(program: Command) {
	program
		.command('tui')
		.description('Launch the interactive terminal UI')
		.option('-m, --model <id>', 'model id or alias')
		.option('-p, --profile <name>', 'profile name')
		.option('--system <text>', 'override system prompt for this session')
		.option(
			'--instructions <text>',
			'additional persistent instructions for this session'
		)
		.action(async (opts: TuiOpts) => {
			const { runTui } = await import('@tui/index');
			await runTui({
				modelFlag: opts.model,
				profileFlag: opts.profile,
				systemOverride: opts.system,
				instructions: opts.instructions,
			});
		});
}
