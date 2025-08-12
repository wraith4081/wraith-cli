/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { runAsk } from '@core/orchestrator';
import { OpenAIProvider } from '@provider/openai';
import { isProviderError } from '@provider/types';
import { loadConfig } from '@store/config';
import type { Command } from 'commander';

export function registerAskCommand(program: Command) {
	program
		.command('ask')
		.description('Single-shot question with streamed response')
		.argument('<prompt...>', 'Question or instruction')
		.option('--json', 'Emit JSON {answer, model, usage, timing}')
		.option('--no-stream', 'Disable token streaming; print once at the end')
		.option(
			'--timeout <ms>',
			'Abort request after <ms> milliseconds',
			Number.parseInt
		)
		.action(
			async (
				promptParts: string[],
				opts: {
					json?: boolean;
					noStream?: boolean;
					timeout?: number;
				}
			) => {
				const prompt = promptParts.join(' ').trim();
				if (!prompt) {
					console.error(
						'Error: prompt is required. Example: ai ask "hello"'
					);
					process.exitCode = 1;
					return;
				}

				const { merged } = loadConfig();
				const ac = new AbortController();
				const signal = ac.signal;

				let timer: NodeJS.Timeout | null = null;
				const cleanup = () => {
					if (timer) {
						clearTimeout(timer);
					}
					process.off('SIGINT', onSigint);
				};
				const onSigint = () => {
					ac.abort();
				};

				process.on('SIGINT', onSigint);
				if (typeof opts.timeout === 'number' && opts.timeout > 0) {
					timer = setTimeout(() => ac.abort(), opts.timeout);
				}

				const provider = new OpenAIProvider();

				const globalOpts = program.opts<{
					model?: string;
					profile?: string;
				}>();

				try {
					const onDelta =
						opts.json || opts.noStream
							? undefined
							: (chunk: string) => process.stdout.write(chunk);
					const { answer, model, usage, timing } = await runAsk(
						{
							prompt,
							modelFlag: globalOpts.model,
							profileFlag: globalOpts.profile,
						},
						{ provider, config: merged, onDelta, signal }
					);

					if (opts.json) {
						const payload = { answer, model, usage, timing };
						console.log(JSON.stringify(payload));
					} else {
						if (opts.noStream) {
							process.stdout.write(answer);
						}
						process.stdout.write('\n');
					}
				} catch (e) {
					process.exitCode = 1;
					if (opts.json) {
						if (isProviderError(e)) {
							console.log(
								JSON.stringify({
									error: {
										code: e.code,
										message: e.message,
										status: e.status,
									},
								})
							);
						} else {
							const msg =
								e instanceof Error ? e.message : String(e);
							console.log(
								JSON.stringify({
									error: { code: 'E_UNKNOWN', message: msg },
								})
							);
						}
					} else if (isProviderError(e)) {
						console.error(`${e.code}: ${e.message}`);
					} else {
						console.error(
							e instanceof Error ? e.message : String(e)
						);
					}
				} finally {
					cleanup();
				}
			}
		);
}
