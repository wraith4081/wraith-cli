import { createLogger } from '@obs/logger';
import sade from 'sade';

const prog = sade('ai');

prog.version('0.1.0').describe('Wraith CLI — developer assistant');

prog.command('hello')
	.describe('Sanity check command')
	.action(() => {
		const log = createLogger((process.env.LOG_LEVEL as 'info') || 'info');
		log.info('Hello from advanced-ai-cli. Bun is working!');
		// biome-ignore lint/suspicious/noConsole: tbd
		console.log('Try: ai --help');
	});

prog.command('help').action(() => prog.help());

prog.parse(process.argv, { lazy: true });
