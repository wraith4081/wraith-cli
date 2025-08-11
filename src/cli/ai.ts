import { getLogger, type LogLevel, setLogLevel } from '@obs/logger';
import { formatBuildInfo, VERSION } from '@util/build-info';
import { getArgValue } from '@util/cli-args';
import sade from 'sade';

if (typeof globalThis.Bun === 'undefined') {
	// biome-ignore lint/suspicious/noConsole: tbd
	console.error(
		'This CLI requires the Bun runtime. Install Bun: https://bun.sh\n' +
			'Tip (Windows): run in Git Bash or WSL, then use: curl -fsSL https://bun.sh/install | bash'
	);
	process.exit(1);
}

const flagLevel = getArgValue('--log-level', '-l') as LogLevel;
if (flagLevel) {
	setLogLevel(flagLevel);
} else if (process.env.LOG_LEVEL) {
	setLogLevel(process.env.LOG_LEVEL as LogLevel);
}

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v')) {
	// biome-ignore lint/suspicious/noConsole: tbd
	console.log(formatBuildInfo());
	process.exit(0);
}

const prog = sade('ai');

prog.version(VERSION ?? '0.0.0').describe('Wraith CLI — developer assistant');

prog.command('hello')
	.describe('Sanity check command')
	.action(() => {
		const log = getLogger();
		log.info({ msg: 'Hello from wraith-cli. Bun is working!' });
		// biome-ignore lint/suspicious/noConsole: tbd.
		console.log('Try: ai --version or ai --help');
	});

prog.command('version')
	.describe('Show detailed version and build information')
	.action(() => {
		// biome-ignore lint/suspicious/noConsole: tbd
		console.log(formatBuildInfo());
	});

prog.command('help').action(() => prog.help());

prog.parse(process.argv, { lazy: true });
