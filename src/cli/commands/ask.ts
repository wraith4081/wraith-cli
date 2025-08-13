import fs from 'node:fs';
import path from 'node:path';
import { type AskResult, runAsk } from '@core/orchestrator';
import { runAskStructured } from '@core/structured';
import { isProviderError } from '@provider/types';
import { type RenderMode, renderText } from '@render/index';

export interface AskCliOptions {
	prompt: string; // "-" to read from stdin
	modelFlag?: string;
	profileFlag?: string;

	// output/formatting
	json?: boolean; // envelope {answer, model, usage, timing} (non-structured)
	stream?: boolean; // default true (ignored when render !== 'markdown')
	render?: RenderMode; // 'markdown' | 'plain' | 'ansi'

	// structured mode
	output?: 'text' | 'json'; // when 'json', requires --schema
	schemaPath?: string;
	attempts?: number; // structured attempts/repair loop
	repair?: boolean; // shorthand: enable a few repair attempts

	// one-off prompt shaping
	systemOverride?: string; // appended to system prompt as "Command Overrides"
	instructions?: string; // injected as a preliminary user message (before main prompt)

	// prompt source
	filePath?: string; // read prompt from a file (alternative to "-")

	// misc
	meta?: boolean; // print model/elapsed to stderr in non-JSON mode
}

export async function handleAskCommand(opts: AskCliOptions): Promise<number> {
	const startedAt = Date.now();

	const prompt = await resolvePromptSource(opts);

	// Structured mode takes precedence and produces ONLY the validated JSON on success
	const structured = (opts.output ?? 'text') === 'json';
	if (structured) {
		if (!opts.schemaPath) {
			return emitError(
				'Structured mode requires --schema <file>',
				startedAt,
				opts.json ?? false
			);
		}
		const attempts = normalizeAttempts(
			typeof opts.attempts === 'number'
				? opts.attempts
				: opts.repair
					? 3
					: 1
		);

		try {
			const res = await runAskStructured({
				prompt,
				schemaPath: path.resolve(opts.schemaPath),
				modelFlag: opts.modelFlag,
				profileFlag: opts.profileFlag,
				maxAttempts: attempts,
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

	// Non-structured path (supports streaming + render modes + optional JSON envelope)
	const render: RenderMode = opts.render ?? 'markdown';
	const forceNoStream = render !== 'markdown';
	const wantStream = opts.stream !== false && !forceNoStream;
	const wantJson = opts.json === true;

	try {
		let streamed = '';
		const result = await runAsk(
			{
				prompt,
				modelFlag: opts.modelFlag,
				profileFlag: opts.profileFlag,
				systemOverride: opts.systemOverride,
				instructions: opts.instructions,
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
			if (!streamed.endsWith('\n')) {
				process.stdout.write('\n');
			}
			if (opts.meta) {
				printMeta(result);
			}
			return 0;
		}

		const rendered = renderText(result.answer, render);
		process.stdout.write(rendered);
		if (!rendered.endsWith('\n')) {
			process.stdout.write('\n');
		}
		if (opts.meta) {
			printMeta(result);
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
	// biome-ignore lint/suspicious/noExplicitAny: CLI frameworks are duck-typed
	const app: any = program;

	// Try sade shape first
	if (
		typeof app.command === 'function' &&
		typeof app.option === 'function' &&
		typeof app.action === 'function'
	) {
		app.command('ask <prompt>')
			.describe('Single question; prints the model response')
			.option('-m, --model <id>', 'Override model id')
			.option('-p, --profile <name>', 'Use profile defaults')
			.option('--json', 'Output a JSON envelope (non-structured mode)')
			.option(
				'--no-stream',
				'Disable streaming output (markdown only streams)'
			)
			.option(
				'--render <mode>',
				'Rendering: plain|markdown|ansi',
				'markdown'
			)
			.option(
				'--output <mode>',
				'Output mode: text|json (use with --schema)',
				'text'
			)
			.option(
				'--schema <file>',
				'JSON/YAML schema file for structured output'
			)
			.option(
				'--attempts <n>',
				'Structured mode max attempts (repair loop)',
				'1'
			)
			.option(
				'--repair',
				'Enable basic schema repair loop (≈ attempts=3)'
			)
			.option(
				'--system <text>',
				'Append a system section just for this command'
			)
			.option(
				'--instructions <text>',
				'Add a user-scoped instruction before the prompt'
			)
			.option(
				'--file <path>',
				'Read prompt from file (alternative to "-" for stdin)'
			)
			.option('--meta', 'Print model + elapsed timing to stderr')
			.action(async (prompt: string, flags: Record<string, unknown>) => {
				const code = await handleAskCommand({
					prompt,
					modelFlag: toOpt(flags.model),
					profileFlag: toOpt(flags.profile),
					json: flags.json === true,
					stream: flags.stream !== false,
					render: toRender(flags.render),
					output: toOutput(flags.output),
					schemaPath: toOpt(flags.schema),
					attempts: toInt(flags.attempts),
					repair: Boolean(flags.repair),
					systemOverride: toOpt(flags.system),
					instructions: toOpt(flags.instructions),
					filePath: toOpt(flags.file),
					meta: Boolean(flags.meta),
				});
				process.exitCode = code;
			});
		return;
	}

	// Commander fallback
	const cmd = app
		.command('ask <prompt>')
		.description('Single question; prints the model response')
		.option('-m, --model <id>', 'Override model id')
		.option('-p, --profile <name>', 'Use profile defaults')
		.option('--json', 'Output a JSON envelope (non-structured mode)')
		.option(
			'--no-stream',
			'Disable streaming output (markdown only streams)'
		)
		.option('--render <mode>', 'Rendering: plain|markdown|ansi', 'markdown')
		.option(
			'--output <mode>',
			'Output mode: text|json (use with --schema)',
			'text'
		)
		.option(
			'--schema <file>',
			'JSON/YAML schema file for structured output'
		)
		.option(
			'--attempts <n>',
			'Structured mode max attempts (repair loop)',
			'1'
		)
		.option('--repair', 'Enable basic schema repair loop (≈ attempts=3)')
		.option(
			'--system <text>',
			'Append a system section just for this command'
		)
		.option(
			'--instructions <text>',
			'Add a user-scoped instruction before the prompt'
		)
		.option(
			'--file <path>',
			'Read prompt from file (alternative to "-" for stdin)'
		)
		.option('--meta', 'Print model + elapsed timing to stderr');

	cmd.action(async (prompt: string, flags: Record<string, unknown>) => {
		const code = await handleAskCommand({
			prompt,
			modelFlag: toOpt(flags.model),
			profileFlag: toOpt(flags.profile),
			json: flags.json === true,
			stream: flags.stream !== false,
			render: toRender(flags.render),
			output: toOutput(flags.output),
			schemaPath: toOpt(flags.schema),
			attempts: toInt(flags.attempts),
			repair: Boolean(flags.repair),
			systemOverride: toOpt(flags.system),
			instructions: toOpt(flags.instructions),
			filePath: toOpt(flags.file),
			meta: Boolean(flags.meta),
		});
		process.exitCode = code;
	});
}

function toOpt(v: unknown): string | undefined {
	return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
function toRender(v: unknown): RenderMode {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
	return s === 'plain' || s === 'ansi' ? (s as RenderMode) : 'markdown';
}
function toOutput(v: unknown): 'text' | 'json' {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
	return s === 'json' ? 'json' : 'text';
}
function toInt(v: unknown): number | undefined {
	const n = typeof v === 'string' ? Number.parseInt(v, 10) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : undefined;
}
async function readAllFromStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const c of process.stdin) {
		chunks.push(Buffer.from(c));
	}
	return Buffer.concat(chunks).toString('utf8');
}
function emitError(msg: string, startedAt: number, asJson: boolean): number {
	if (asJson) {
		const out = {
			ok: false as const,
			error: { message: msg },
			timing: { startedAt, elapsedMs: 0 },
		};
		process.stdout.write(`${JSON.stringify(out)}\n`);
		return 1;
	}
	process.stderr.write(`${msg}\n`);
	return 1;
}
function normalizeAttempts(n?: number): number {
	if (!(n && Number.isFinite(n)) || n < 1) {
		return 1;
	}
	if (n > 5) {
		return 5;
	}
	return Math.floor(n);
}
function printMeta(res: AskResult): void {
	const ms = res.timing?.elapsedMs ?? 0;
	const model = res.model ?? 'unknown';
	process.stderr.write(`[meta] model=${model} elapsed=${ms}ms\n`);
}

export function formatAskJsonOk(res: AskResult) {
	return {
		ok: true as const,
		answer: res.answer,
		model: res.model,
		usage: res.usage ?? null,
		timing: res.timing,
	};
}

export function formatAskJsonErr(err: unknown, startedAt: number) {
	const elapsedMs = Date.now() - startedAt;
	const error = isProviderError(err)
		? { code: err.code, status: err.status, message: err.message }
		: err instanceof Error
			? { message: err.message }
			: { message: String(err) };
	return { ok: false as const, error, timing: { startedAt, elapsedMs } };
}

async function resolvePromptSource(opts: AskCliOptions): Promise<string> {
	if (opts.prompt === '-') {
		return await readAllFromStdin();
	}
	if (opts.filePath) {
		try {
			return fs.readFileSync(path.resolve(opts.filePath), 'utf8');
		} catch {
			// fall back to literal prompt if file missing
		}
	}
	return String(opts.prompt ?? '');
}
