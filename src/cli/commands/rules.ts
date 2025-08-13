/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { OpenAIProvider } from '@provider/openai';
import { isProviderError } from '@provider/types';
import { generateProjectRules, saveProjectRules } from '@rules/generate';
import { loadUserAndProjectRules } from '@rules/loader';
import {
	appendRulesToSection,
	loadRulesetForScope,
	type RulesScope,
	saveRulesetForScope,
} from '@rules/storage';
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
				// const { merged } = loadConfig();
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

	rules
		.command('add')
		.description('Append rule lines under a title in user or project rules')
		.option(
			'--project',
			'append to project rules (./.wraith/project-rules.*)'
		)
		.option('--user', 'append to user rules (~/.wraith/user-rules.*)')
		.requiredOption(
			'--title <title>',
			'section title to append to (will create if missing)'
		)
		.option(
			'--rule <text>',
			'rule text (repeatable)',
			(val, prev: string[]) => (prev ? [...prev, val] : [val]),
			[]
		)
		.option(
			'-f, --format <format>',
			'yaml|json (used only when creating a new file)',
			'yaml'
		)
		.action(
			(opts: {
				project?: boolean;
				user?: boolean;
				title: string;
				rule: string[]; // accumulated by parser
				format?: 'yaml' | 'json';
			}) => {
				const scopeCount =
					Number(Boolean(opts.project)) + Number(Boolean(opts.user));
				if (scopeCount !== 1) {
					console.error(
						'Specify exactly one of --project or --user.'
					);
					process.exitCode = 1;
					return;
				}
				const scope: RulesScope = opts.project ? 'project' : 'user';
				const rulesToAdd = Array.isArray(opts.rule) ? opts.rule : [];
				if (rulesToAdd.length === 0) {
					console.error(
						'Provide at least one --rule "<text>" to add.'
					);
					process.exitCode = 1;
					return;
				}

				try {
					const { ruleset } = loadRulesetForScope(scope);
					const updated = appendRulesToSection(
						ruleset,
						opts.title,
						rulesToAdd
					);
					const { path } = saveRulesetForScope(scope, updated, {
						format: (opts.format as 'yaml' | 'json') ?? 'yaml',
					});
					console.log(
						`Added ${rulesToAdd.length} rule(s) under "${opts.title}" in ${scope} rules: ${path}`
					);
				} catch (e) {
					console.error(e instanceof Error ? e.message : String(e));
					process.exitCode = 1;
				}
			}
		);

	rules
		.command('list')
		.description('List rules grouped by title and scope')
		.option(
			'--scope <scope>',
			'project|user|effective (default: effective)'
		)
		.option('--json', 'output JSON')
		.action(
			(opts: {
				scope?: 'project' | 'user' | 'effective';
				json?: boolean;
			}) => {
				const scope = (opts.scope ?? 'effective') as
					| 'project'
					| 'user'
					| 'effective';
				if (scope === 'effective') {
					const { userSections, projectSections } =
						loadUserAndProjectRules();
					if (opts.json) {
						console.log(
							JSON.stringify(
								{
									scope: 'effective',
									user: userSections,
									project: projectSections,
								},
								null,
								2
							)
						);
						return;
					}
					printSections('User Rules', userSections);
					printSections('Project Rules', projectSections);
					return;
				}

				try {
					const { ruleset } = loadRulesetForScope(scope);
					if (opts.json) {
						console.log(
							JSON.stringify(
								{ scope, sections: ruleset.sections },
								null,
								2
							)
						);
						return;
					}
					printSections(
						scope === 'user' ? 'User Rules' : 'Project Rules',
						ruleset.sections
					);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					if (opts.json) {
						console.log(
							JSON.stringify({ scope, error: msg }, null, 2)
						);
					} else {
						console.error(msg);
					}
					process.exitCode = 1;
				}
			}
		);
}

function printSections(
	label: string,
	sections: { title: string; rules: string[] }[]
) {
	console.log(`${label}:`);
	if (!sections || sections.length === 0) {
		console.log('  (none)');
		return;
	}
	for (const sec of sections) {
		console.log(`- ${sec.title}`);
		if (!sec.rules || sec.rules.length === 0) {
			console.log('  (no rules)');
		} else {
			for (const r of sec.rules) {
				console.log(`  • ${r}`);
			}
		}
	}
}
