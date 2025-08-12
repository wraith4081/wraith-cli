/** biome-ignore-all lint/suspicious/noConsole: tbd */

import fs from 'node:fs';
import { loadUserAndProjectRules, type OverLimitBehavior } from '@rules/loader';
import {
	buildEffectiveSystemPrompt,
	getDefaultSystemPrompt,
	type MergeMode,
} from '@rules/manager';
import { loadConfig } from '@store/config';
import type { Command } from 'commander';

export interface ComputePromptOptions {
	config?: unknown;
	profile?: string;
	systemOverride?: { content: string; mode: MergeMode };
	userDir?: string;
	projectDir?: string;
	maxChars?: number;
	behavior?: OverLimitBehavior;
}

export function computeEffectivePrompt(
	opts: ComputePromptOptions = {}
): Promise<{
	prompt: string;
	meta: {
		profile?: string;
		truncated: boolean;
		userSectionCount: number;
		projectSectionCount: number;
		overrideMode?: MergeMode;
	};
}> {
	const { userSections, projectSections, truncated } =
		loadUserAndProjectRules({
			config: opts.config,
			profileName: opts.profile,
			userDir: opts.userDir,
			projectDir: opts.projectDir,
			maxChars:
				typeof opts.maxChars === 'number' ? opts.maxChars : 16_000,
			overLimitBehavior: opts.behavior ?? 'summarize',
		});

	const prompt = buildEffectiveSystemPrompt({
		defaultPrompt: getDefaultSystemPrompt(),
		userSections,
		projectSections,
		override: opts.systemOverride,
	});

	return {
		prompt,
		meta: {
			profile: opts.profile,
			truncated,
			userSectionCount: userSections.length,
			projectSectionCount: projectSections.length,
			overrideMode: opts.systemOverride?.mode,
		},
	};
}

function readSystemOverrideContent(spec?: string): string | undefined {
	if (!spec || spec.trim().length === 0) {
		return;
	}
	const s = spec.trim();
	// Allow "@file" or direct path or literal text
	if (s.startsWith('@')) {
		const file = s.slice(1);
		if (!file) {
			return;
		}
		return fs.readFileSync(file, 'utf8');
	}
	// If the string is a path to an existing file, read it; else return the string as literal
	if (fs.existsSync(s) && fs.statSync(s).isFile()) {
		return fs.readFileSync(s, 'utf8');
	}
	return s;
}

export function registerPromptCommand(program: Command) {
	const cmd = program
		.command('prompt')
		.description('Prompt management commands');

	cmd.command('show')
		.description(
			'Display the effective system prompt (default + user + project + optional override)'
		)
		.option('--json', 'Output JSON instead of plain text')
		.option(
			'--system <textOr@file>',
			'Per-command system override (text or @path)'
		)
		.option(
			'--mode <mergeOrReplace>',
			'Override mode: merge|replace (default: merge)'
		)
		.option(
			'--max-chars <n>',
			'Size threshold before summarization/reject (default: 16000)',
			(v) => Number.parseInt(v, 10)
		)
		.option('--behavior <mode>', 'summarize|reject (default: summarize)')
		.action(
			async (opts: {
				json?: boolean;
				system?: string;
				mode?: 'merge' | 'replace';
				maxChars?: number;
				behavior?: 'summarize' | 'reject';
			}) => {
				const global = program.opts<{ profile?: string }>();
				const { merged } = loadConfig();

				const overrideContent = readSystemOverrideContent(opts.system);
				const override = overrideContent
					? {
							content: overrideContent,
							mode: (opts.mode as MergeMode) ?? 'merge',
						}
					: undefined;

				const { prompt, meta } = await computeEffectivePrompt({
					config: merged,
					profile: global.profile,
					systemOverride: override,
					maxChars:
						typeof opts.maxChars === 'number'
							? opts.maxChars
							: 16_000,
					behavior:
						(opts.behavior as OverLimitBehavior) ?? 'summarize',
				});

				if (opts.json) {
					console.log(
						JSON.stringify(
							{
								prompt,
								meta,
							},
							null,
							2
						)
					);
					return;
				}

				process.stdout.write(prompt);
				process.stdout.write('\n');
			}
		);
}
