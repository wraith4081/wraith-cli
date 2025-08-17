/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { getLogger, type LogLevel, setLogLevel } from '@obs/logger';
import { enableTrace } from '@obs/trace';
import { loadConfig } from '@store/config';
import { formatBuildInfo, VERSION } from '@util/build-info';
import { checkOptionalDeps } from '@util/optional-deps';
import { Command } from 'commander';
import { registerAskCommand } from './commands/ask';
import { registerBatchCommand } from './commands/batch';
import { registerConfigureCommand } from './commands/configure';
import { registerModelsCommand } from './commands/models';
import { registerPromptCommand } from './commands/prompt';
import { registerRulesCommand } from './commands/rules';
import { registerSelfUpdateCommand } from './commands/self-update';
import {
	registerSessionsCommands,
	registerSessionsHistorySubcommand,
} from './commands/sessions';
import { registerTemplatesCommand } from './commands/templates';
import { registerTuiCommand } from './commands/tui';
import { registerUsageCommand } from './commands/usage';

if (typeof globalThis.Bun === 'undefined') {
	console.error(
		'This CLI requires the Bun runtime. Install Bun: https://bun.sh\n' +
			'Tip (Windows): run in Git Bash or WSL, then use: curl -fsSL https://bun.sh/install | bash'
	);
	process.exit(1);
}

const rawArgv = process.argv.slice(2);
const argvSansDashes = rawArgv.filter((a) => a !== '--');

if (argvSansDashes.includes('--version') || argvSansDashes.includes('-v')) {
	console.log(formatBuildInfo());
	process.exit(0);
}

const program = new Command();
program
	.name('ai')
	.description('Wraith CLI — developer assistant')
	.version(VERSION ?? '0.0.0');

program
	.option('-l, --log-level <level>', 'log level (debug|info|warn|error)')
	.option('-p, --profile <name>', 'active profile name')
	.option('-m, --model <name>', 'model id or alias')
	.option(
		'--net <mode>',
		'network policy (on|off|prompt)',
		(value: string) => {
			const v = String(value || '').toLowerCase();
			return v === 'on' || v === 'off' || v === 'prompt' ? v : 'prompt';
		},
		'prompt'
	);

program.hook('preAction', async (thisCmd) => {
	const opts = thisCmd.opts<{
		logLevel?: string;
		trace?: string | boolean;
		net?: 'on' | 'off' | 'prompt';
	}>();
	const level = (opts.logLevel ||
		process.env.LOG_LEVEL ||
		'info') as LogLevel;
	setLogLevel(level);

	if (opts.trace) {
		const file = typeof opts.trace === 'string' ? opts.trace : undefined;
		enableTrace({ filePath: file });
	}

	// Expose chosen net mode so subcommands can build a ToolPolicy accordingly.
	// (We keep it as an env var to avoid threading state everywhere.)
	const netMode = opts.net ?? 'prompt';
	process.env.WRAITH_NET = netMode;

	const log = getLogger();
	log.info({ msg: 'cli.net-policy', mode: netMode });
	// Optional dependency diagnostics — warn only, do not block

	try {
		await checkOptionalDeps();
	} catch {
		/* ignore */
	}
});

program
	.command('hello')
	.description('Sanity check command')
	.action(() => {
		const log = getLogger();
		log.info({ msg: 'Hello from wraith-cli. Bun is working!' });
		console.log('Try: ai --version or ai --help');
	});

program
	.command('version')
	.description('Show detailed version and build information')
	.action(() => {
		console.log(formatBuildInfo());
	});

program
	.command('config')
	.description('Work with configuration under .wraith')
	.command('show')
	.option('--json', 'Print merged config as JSON')
	.action((opts: { json?: boolean }) => {
		const { merged, userPath, projectPath } = loadConfig();
		if (opts?.json) {
			console.log(
				JSON.stringify({ merged, userPath, projectPath }, null, 2)
			);
		} else {
			console.log('User config:', userPath ?? '(none)');
			console.log('Project config:', projectPath ?? '(none)');
			console.log('Merged (JSON):');
			console.log(JSON.stringify(merged, null, 2));
		}
	});

registerConfigureCommand(program);
registerModelsCommand(program);
registerAskCommand(program);
registerRulesCommand(program);
registerPromptCommand(program);
registerSessionsCommands(program);
registerSessionsHistorySubcommand(program);
registerTemplatesCommand(program);
registerBatchCommand(program);
registerUsageCommand(program);
registerSelfUpdateCommand(program);
registerTuiCommand(program);

program.action(async () => {
	// lazy import keeps cold-start fast if user never uses TUI
	const { runTui } = await import('@tui/index');
	const root = program.opts<{
		model?: string;
		profile?: string;
		system?: string;
		instructions?: string;
	}>();
	await runTui({
		modelFlag: root.model,
		profileFlag: root.profile,
		systemOverride: root.system,
		instructions: root.instructions,
	});
});

program.parse([process.argv[0], process.argv[1], ...argvSansDashes]);
