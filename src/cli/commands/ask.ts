import path from 'node:path';
import { type AskResult, runAsk } from '@core/orchestrator';
import { runAskStructured } from '@core/structured';
import { isProviderError } from '@provider/types';
import { type RenderMode, renderText } from '@render/markdown';

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
	stream?: boolean;
	render?: RenderMode;
	output?: 'text' | 'json';
	schemaPath?: string;
}

export async function handleAskCommand(opts: AskCliOptions): Promise<number> {
	const startedAt = Date.now();

	// Structured mode enforcement
	const structured = (opts.output ?? 'text') === 'json';
	if (structured && !opts.schemaPath) {
		const msg = 'Structured mode requires --schema <file>';
		if (opts.json) {
			process.stdout.write(
				`${JSON.stringify({ ok: false, error: { message: msg }, timing: { startedAt, elapsedMs: 0 } })}\n`
			);
			return 1;
		}
		process.stderr.write(`${msg}\n`);
		return 1;
	}

	// Read prompt (stdin allowed)
	const prompt =
		opts.prompt === '-'
			? await readAllFromStdin()
			: String(opts.prompt ?? '');

	if (structured && opts.schemaPath) {
		try {
			const res = await runAskStructured({
				prompt,
				schemaPath: path.resolve(opts.schemaPath),
				modelFlag: opts.modelFlag,
				profileFlag: opts.profileFlag,
				maxAttempts: 1,
			});

			if (res.ok) {
				process.stdout.write(`${JSON.stringify(res.data)}\n`);
				return 0;
			}
			const out = {
				ok: false as const,
				error: {
					message: 'Schema validation failed',
					errors: res.errors,
				},
				text: res.text,
				timing: res.timing,
			};
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 1;
		} catch (err) {
			const out = formatAskJsonErr(err, startedAt);
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 1;
		}
	}

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

		if (wantStream && streamed.length > 0) {
			// streamed markdown already printed; ensure newline
			if (!streamed.endsWith('\n')) {
				process.stdout.write('\n');
			}
			return 0;
		}

		// Non-stream path or forced render: print whole rendered answer
		const rendered = renderText(result.answer, render);
		process.stdout.write(rendered);
		if (!rendered.endsWith('\n')) {
			process.stdout.write('\n');
		}
		return 0;
	} catch (err) {
		if (wantJson) {
			const out = formatAskJsonErr(err, startedAt);
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 1;
		}
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
			.option(
				'--render <mode>',
				'Rendering: plain|markdown|ansi',
				'markdown'
			)
			.option(
				'--output <mode>',
				'Output mode: text|json (use with --schema for structured JSON)',
				'text'
			)
			.option(
				'--schema <file>',
				'JSON/YAML schema file for structured output'
			)
			.option('--no-stream', 'Disable token streaming; print once at end')
			.action(async (prompt: string, flags: Record<string, unknown>) => {
				const code = await handleAskCommand({
					prompt,
					render: toRender(flags.render),
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
			)
			.option(
				'--output <mode>',
				'Output mode: text|json (use with --schema for structured JSON)',
				'text'
			)
			.option(
				'--schema <file>',
				'JSON/YAML schema file for structured output'
			);

		cmd.action(async (prompt: string, flags: Record<string, unknown>) => {
			const code = await handleAskCommand({
				prompt,
				render: toRender(flags.render),
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

function toRender(v: unknown): RenderMode {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
	return s === 'plain' || s === 'ansi' ? (s as RenderMode) : 'markdown';
}
