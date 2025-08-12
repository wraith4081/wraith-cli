import { OpenAIProvider } from '@provider/openai';
import { isProviderError } from '@provider/types';
import { generateProjectRules, saveProjectRules } from '@rules/generate';
import { loadConfig } from '@store/config';
import type { Command } from 'commander';

export function registerRulesCommand(program: Command) {
	const rules = program
		.command('rules')
		.description('Manage user and project rules');

	rules
		.command('generate')
		.description(
			'Synthesize rules and persist to ./.wraith/project-rules.(yaml|json)'
		)
		.requiredOption(
			'--project <prompt>',
			'Generate project rules from the given prompt'
		)
		.option('-f, --format <format>', 'yaml|json (default: yaml)')
		.option(
			'--max-chars <n>',
			'size threshold per-scope before summarization/reject (default: 16000)',
			(v) => Number.parseInt(v, 10)
		)
		.option('--behavior <mode>', 'summarize|reject (default: summarize)')
		.option(
			'--retries <n>',
			'auto-repair attempts for invalid JSON (default: 1)',
			(v) => Number.parseInt(v, 10)
		)
		.action(
			async (opts: {
				project: string;
				format?: 'yaml' | 'json';
				maxChars?: number;
				behavior?: 'summarize' | 'reject';
				retries?: number;
			}) => {
				const provider = new OpenAIProvider();
				const { merged } = loadConfig(); // reserved for future per-profile rules paths

				try {
					const ruleset = await generateProjectRules(
						opts.project,
						{ provider },
						{
							maxChars:
								typeof opts.maxChars === 'number'
									? opts.maxChars
									: 16_000,
							overLimitBehavior:
								(opts.behavior as 'summarize' | 'reject') ??
								'summarize',
							retries:
								typeof opts.retries === 'number'
									? opts.retries
									: 1,
						}
					);
					const { path } = saveProjectRules(ruleset, {
						format: (opts.format as 'yaml' | 'json') ?? 'yaml',
					});
					console.log(`Saved Project Rules to: ${path}`);
				} catch (e) {
					if (isProviderError(e)) {
						console.error(`${e.code}: ${e.message}`);
					} else {
						console.error(
							e instanceof Error ? e.message : String(e)
						);
					}
					process.exitCode = 1;
				}
			}
		);
}
