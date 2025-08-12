/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import { getLogger } from '@obs/logger';

import { type ConfigUnknown, loadConfig, saveConfig } from '@store/config';
import {
	ApprovalPolicyZ,
	type ConfigV1,
	ConfigV1Z,
	explainZodError,
	LogLevelZ,
	RAGModeZ,
	RenderModeZ,
} from '@store/schema';
import type { Command } from 'commander';

type Scope = 'user' | 'project';
type Format = 'yaml' | 'json';

interface ConfigureOptions {
	scope?: Scope;
	format?: Format;
	yes?: boolean;
	profile?: string;
	model?: string;
	embeddingModel?: string;
	ragMode?: 'hot' | 'cold' | 'auto';
	approvals?: 'auto' | 'prompt' | 'never';
	render?: 'plain' | 'markdown' | 'ansi';
	logLevel?: 'debug' | 'info' | 'warn' | 'error';
	sandboxRoot?: string;
	networkPolicy?: 'on' | 'off' | 'prompt';
}

export function registerConfigureCommand(program: Command) {
	program
		.command('configure')
		.description(
			'Interactive setup to create a Wraith config at ~/.wraith or ./.wraith'
		)
		.option(
			'-s, --scope <scope>',
			'config scope: user|project (default: user)'
		)
		.option(
			'-f, --format <format>',
			'file format: yaml|json (default: yaml)'
		)
		.option('-y, --yes', 'non-interactive; write sensible defaults')
		.option('--profile <name>', 'default profile name (e.g., dev)')
		.option('--model <name>', 'default model (e.g., gpt-5)')
		.option(
			'--embedding-model <name>',
			'embedding model (e.g., text-embedding-3-large)'
		)
		.option('--rag-mode <mode>', 'hot|cold|auto (default: auto)')
		.option('--approvals <policy>', 'auto|prompt|never (default: prompt)')
		.option('--render <mode>', 'plain|markdown|ansi (default: markdown)')
		.option('--log-level <level>', 'debug|info|warn|error (default: info)')
		.option('--sandbox-root <path>', 'tool sandbox root (default: .)')
		.option('--network-policy <policy>', 'on|off|prompt (default: prompt)')
		.action(runConfigure);
}

export async function runConfigure(rawOpts: ConfigureOptions) {
	const log = getLogger();
	const scope: Scope = (rawOpts.scope as Scope) ?? 'user';
	const format: Format = (rawOpts.format as Format) ?? 'yaml';
	const nonInteractive = !!rawOpts.yes;

	// Pre-fill defaults
	const defaults = {
		profile: rawOpts.profile ?? 'dev',
		model: rawOpts.model ?? 'gpt-5',
		embeddingModel: rawOpts.embeddingModel ?? 'text-embedding-3-large',
		ragMode: (rawOpts.ragMode as 'hot' | 'cold' | 'auto') ?? 'auto',
		approvals:
			(rawOpts.approvals as 'auto' | 'prompt' | 'never') ?? 'prompt',
		render: (rawOpts.render as 'plain' | 'markdown' | 'ansi') ?? 'markdown',
		logLevel:
			(rawOpts.logLevel as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
		sandboxRoot: rawOpts.sandboxRoot ?? '.',
		networkPolicy:
			(rawOpts.networkPolicy as 'on' | 'off' | 'prompt') ?? 'prompt',
	};

	let rl: readline.Interface | null = null;
	try {
		if (!nonInteractive && process.stdin.isTTY && process.stdout.isTTY) {
			rl = readline.createInterface({ input, output, terminal: true });
		}

		const ask = async (q: string, def?: string): Promise<string> => {
			if (!rl) {
				return def ?? '';
			}
			const prompt = def ? `${q} [${def}]: ` : `${q}: `;
			const ans = await rl.question(prompt);
			return ans?.trim() || def || '';
		};

		// Gentle overwrite confirmation if a config already exists
		const { userPath, projectPath } = loadConfig();
		const existingPath = scope === 'user' ? userPath : projectPath;
		if (existingPath) {
			const overwrite = nonInteractive
				? true
				: (
						await ask(
							`Found existing ${scope} config at ${existingPath}. Overwrite? (y/N)`,
							'N'
						)
					).toLowerCase() === 'y';
			if (!overwrite) {
				console.log('Aborted. No changes made.');
				return;
			}
		}

		// Interactive questions (or accept defaults)
		const profile = nonInteractive
			? defaults.profile
			: await ask('Default profile name', defaults.profile);
		const model = nonInteractive
			? defaults.model
			: await ask('Default model', defaults.model);
		const embeddingModel = nonInteractive
			? defaults.embeddingModel
			: await ask('Embedding model', defaults.embeddingModel);

		const ragMode = (
			nonInteractive
				? defaults.ragMode
				: await ask('RAG mode (hot|cold|auto)', defaults.ragMode)
		) as 'hot' | 'cold' | 'auto';
		if (!RAGModeZ.safeParse(ragMode).success) {
			console.error('Invalid RAG mode; expected hot|cold|auto');
			process.exitCode = 1;
			return;
		}

		const approvals = (
			nonInteractive
				? defaults.approvals
				: await ask(
						'Tool approval policy (auto|prompt|never)',
						defaults.approvals
					)
		) as 'auto' | 'prompt' | 'never';
		if (!ApprovalPolicyZ.safeParse(approvals).success) {
			console.error('Invalid approvals; expected auto|prompt|never');
			process.exitCode = 1;
			return;
		}

		const render = (
			nonInteractive
				? defaults.render
				: await ask(
						'Render mode (plain|markdown|ansi)',
						defaults.render
					)
		) as 'plain' | 'markdown' | 'ansi';
		if (!RenderModeZ.safeParse(render).success) {
			console.error('Invalid render; expected plain|markdown|ansi');
			process.exitCode = 1;
			return;
		}

		const logLevel = (
			nonInteractive
				? defaults.logLevel
				: await ask(
						'Log level (debug|info|warn|error)',
						defaults.logLevel
					)
		) as 'debug' | 'info' | 'warn' | 'error';
		if (!LogLevelZ.safeParse(logLevel).success) {
			console.error('Invalid log level; expected debug|info|warn|error');
			process.exitCode = 1;
			return;
		}

		const sandboxRoot = nonInteractive
			? defaults.sandboxRoot
			: await ask(
					'Tool sandbox root (restrict fs tools to this path)',
					defaults.sandboxRoot
				);
		const networkPolicy = (
			nonInteractive
				? defaults.networkPolicy
				: await ask(
						'Network policy (on|off|prompt)',
						defaults.networkPolicy
					)
		) as 'on' | 'off' | 'prompt';

		// Assemble a minimal but useful config (defaults + one profile)
		const cfg: ConfigV1 = {
			version: '1',
			defaults: {
				profile,
				model,
				embeddingModel,
				rag: {
					mode: ragMode,
					cold: { driver: 'lancedb' },
				},
				tools: {
					sandboxRoot,
					networkPolicy,
				},
				approvals,
				render,
				logging: { level: logLevel },
			},
			profiles: {
				[profile]: {
					model,
					embeddingModel,
					rag: { mode: ragMode, cold: { driver: 'lancedb' } },
					tools: { sandboxRoot, networkPolicy },
				},
			},
		};

		// Validate before saving
		try {
			ConfigV1Z.parse(cfg);
		} catch (e) {
			const issues = explainZodError(e);
			console.error('Configuration is invalid:');
			for (const issue of issues) {
				console.error(`- ${issue.path}: ${issue.message}`);
			}
			process.exitCode = 1;
			return;
		}

		const { path } = saveConfig(scope, cfg as unknown as ConfigUnknown, {
			format,
		});
		console.log(`Saved ${scope} config to: ${path}`);
		console.log('\nOpenAI API key is not stored in config.');
		if (process.env.OPENAI_API_KEY) {
			console.log(
				'Detected OPENAI_API_KEY in your environment. You are good to go.'
			);
		} else {
			console.log(
				'To set your OpenAI API key, run in your shell (example):'
			);
			console.log('  export OPENAI_API_KEY="sk-..."');
			console.log(
				'Or add it to your shell profile (e.g., ~/.bashrc, ~/.zshrc).'
			);
		}
		console.log('\nNext steps:');
		console.log('  - Try: ai config show');
		console.log('  - Try: ai ask "hello" --model gpt-5');
		log.info({ msg: 'configure-complete', scope, path, format });
	} finally {
		if (rl) {
			rl.close();
		}
	}
}
