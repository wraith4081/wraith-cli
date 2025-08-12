/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { getLogger, type LogLevel, setLogLevel } from '@obs/logger';
import { loadConfig } from '@store/config';
import { formatBuildInfo, VERSION } from '@util/build-info';
import { Command } from 'commander';
import { registerAskCommand } from './commands/ask';
import { registerConfigureCommand } from './commands/configure';
import { registerModelsCommand } from './commands/models';
import { registerRulesCommand } from './commands/rules';

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

program.option('-l, --log-level <level>', 'log level (debug|info|warn|error)');
program.option('-p, --profile <name>', 'active profile name');
program.option('-m, --model <name>', 'model id or alias');

program.hook('preAction', (thisCmd) => {
	const opts = thisCmd.opts<{ logLevel?: string }>();
	const level = (opts.logLevel ||
		process.env.LOG_LEVEL ||
		'info') as LogLevel;
	setLogLevel(level);
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

program.parse([process.argv[0], process.argv[1], ...argvSansDashes]);
