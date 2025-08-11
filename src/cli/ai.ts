import { createLogger } from '@obs/logger';
import { formatBuildInfo, VERSION } from '@util/build-info';
import sade from 'sade';

if (typeof globalThis.Bun === 'undefined') {
	// biome-ignore lint/suspicious/noConsole: tbd
	console.error(
		'This CLI requires the Bun runtime. Install Bun: https://bun.sh\n' +
			'Tip (Windows): run in Git Bash or WSL, then use: curl -fsSL https://bun.sh/install | bash'
	);
	process.exit(1);
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
		const log = createLogger((process.env.LOG_LEVEL as 'info') || 'info');
		log.info('Hello from advanced-ai-cli. Bun is working!');
		// biome-ignore lint/suspicious/noConsole: tbd
		console.log('Try: ai --help');
	});

prog.command('help').action(() => prog.help());

prog.command('version')
	.describe('Show detailed version and build information')
	.action(() => {
		// biome-ignore lint/suspicious/noConsole: tbd
		console.log(formatBuildInfo());
	});

prog.parse(process.argv, { lazy: true });
