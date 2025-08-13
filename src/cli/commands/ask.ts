import { type AskResult, runAsk } from '@core/orchestrator';
import { isProviderError } from '@provider/types';

export function formatAskJsonOk(result: AskResult) {
	return {
		ok: true as const,
		answer: result.answer,
		model: result.model,
		usage: result.usage ?? null,
		timing: result.timing,
	};
}

export function formatAskJsonErr(err: unknown, startedAt: number) {
	const elapsedMs = Date.now() - startedAt;
	let code: string | undefined;
	let status: number | undefined;
	let message = 'Unknown error';
	if (isProviderError(err)) {
		code = err.code;
		status = err.status;
		message = err.message;
	} else if (err instanceof Error) {
		message = err.message;
	} else if (typeof err === 'string') {
		message = err;
	}

	return {
		ok: false as const,
		error: { code, status, message },
		timing: { startedAt, elapsedMs },
	};
}

export interface AskCliOptions {
	prompt: string;
	modelFlag?: string;
	profileFlag?: string;
	json?: boolean;
	stream?: boolean; // default true unless --no-stream
}

export async function handleAskCommand(opts: AskCliOptions): Promise<number> {
	const startedAt = Date.now();

	// Read prompt from stdin if '-' is passed
	const prompt =
		opts.prompt === '-'
			? await readAllFromStdin()
			: String(opts.prompt ?? '');

	const wantJson = opts.json === true;
	const wantStream = opts.stream !== false; // default: stream unless --no-stream

	try {
		let streamed = '';
		const result = await runAsk(
			{
				prompt,
				modelFlag: opts.modelFlag,
				profileFlag: opts.profileFlag,
			},
			{
				onDelta:
					wantJson || !wantStream
						? undefined
						: (d) => {
								streamed += d;
								process.stdout.write(d);
							},
			}
		);

		if (wantJson) {
			const out = formatAskJsonOk(result);
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 0;
		}

		// If we didn't stream, print the whole answer now.
		if (!wantStream || streamed.length === 0) {
			process.stdout.write(result.answer);
			if (!result.answer.endsWith('\n')) {
				process.stdout.write('\n');
			}
		}
		return 0;
	} catch (err) {
		if (wantJson) {
			const out = formatAskJsonErr(err, startedAt);
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 1;
		}
		// Human-readable stderr
		const msg = isProviderError(err)
			? `[${err.code}${err.status ? ` ${err.status}` : ''}] ${err.message}`
			: err instanceof Error
				? err.message
				: String(err);
		process.stderr.write(`${msg}\n`);
		return 1;
	}
}

export function registerAskCommand(program: unknown): void {
	const isSade =
		typeof (program as { command?: unknown }).command === 'function' &&
		typeof (program as { option?: unknown }).option === 'function' &&
		typeof (program as { action?: unknown }).action === 'function';

	const isCommander =
		typeof (program as { command?: unknown }).command === 'function' &&
		typeof (program as { description?: unknown }).description ===
			'function';

	if (isSade) {
		// biome-ignore lint/suspicious/noExplicitAny: CLI duck-typing
		const app = program as any;
		app.command('ask <prompt>')
			.describe(
				'Single-shot ask with streaming output (use "-" to read prompt from stdin)'
			)
			.option('-m, --model <id>', 'Override model id')
			.option('-p, --profile <name>', 'Use profile defaults')
			.option(
				'--json',
				'Emit JSON { ok, answer|error, model, usage, timing }'
			)
			.option('--no-stream', 'Disable token streaming; print once at end')
			.action(async (prompt: string, flags: Record<string, unknown>) => {
				const code = await handleAskCommand({
					prompt,
					modelFlag: toOpt(flags.model),
					profileFlag: toOpt(flags.profile),
					json: !!flags.json,
					stream:
						!(flags as { stream?: boolean }).stream === false
							? false
							: (flags as { stream?: boolean }).stream !== false,
				});
				process.exitCode = code;
			});
		return;
	}

	if (isCommander) {
		// biome-ignore lint/suspicious/noExplicitAny: CLI duck-typing
		const app = program as any;
		const cmd = app
			.command('ask <prompt>')
			.description(
				'Single-shot ask with streaming output (use "-" to read prompt from stdin)'
			)
			.option('-m, --model <id>', 'Override model id')
			.option('-p, --profile <name>', 'Use profile defaults')
			.option(
				'--json',
				'Emit JSON { ok, answer|error, model, usage, timing }',
				false
			)
			.option(
				'--no-stream',
				'Disable token streaming; print once at end',
				false
			);

		cmd.action(async (prompt: string, flags: Record<string, unknown>) => {
			const code = await handleAskCommand({
				prompt,
				modelFlag: toOpt(flags.model),
				profileFlag: toOpt(flags.profile),
				json: !!flags.json,
				stream: !(flags as { stream?: boolean }).stream, // commander sets .stream=false when --no-stream is passed
			});
			process.exitCode = code;
		});
		return;
	}

	// Fallback: do nothing (caller can use handleAskCommand directly)
}

function toOpt(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function readAllFromStdin(): Promise<string> {
	return new Promise((resolve) => {
		const chunks: Buffer[] = [];
		if (process.stdin.isTTY) {
			// Nothing to read; treat as empty
			resolve('');
			return;
		}
		process.stdin.on('data', (c) =>
			chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)))
		);
		process.stdin.on('end', () =>
			resolve(Buffer.concat(chunks).toString('utf8'))
		);
		process.stdin.resume();
	});
}
