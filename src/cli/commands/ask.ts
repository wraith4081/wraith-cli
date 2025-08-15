/** biome-ignore-all lint/suspicious/noConsole: tbd */

import fs from 'node:fs';
import path from 'node:path';
import { type AskResult, runAsk } from '@core/orchestrator';
import { runAskStructured } from '@core/structured';
import { isProviderError } from '@provider/types';
import { type RenderMode, renderText } from '@render/index';
import type { Command } from 'commander';

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
	save?: string; // session name to persist

	// reliability
	retries?: number; // retry attempts on timeout / 429 / 5xx
	backoffMs?: number; // base backoff in ms (exp grows from here)
	jitterPct?: number; // 0..1 jitter factor (default 0.2)
	timeoutMs?: number; // per-attempt timeout
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

	// Reliability knobs
	const retries = clampInt(opts.retries, 0, 6, 2);
	const backoffMs = Math.max(1, opts.backoffMs ?? 500);
	const jitterPct = clampFloat(opts.jitterPct, 0, 1, 0.2);
	const timeoutMs = Number.isFinite(opts.timeoutMs as number)
		? (opts.timeoutMs as number)
		: undefined;

	// To avoid duplicate partial output in case of retries, disable streaming
	// when reliability features are in play.
	const enableStreaming = wantStream && retries === 0 && !timeoutMs;

	try {
		let streamed = '';
		const doAttempt = (onDelta?: (s: string) => void) =>
			runAsk(
				{
					prompt,
					modelFlag: opts.modelFlag,
					profileFlag: opts.profileFlag,
					systemOverride: opts.systemOverride,
					instructions: opts.instructions,
				},
				{ onDelta }
			);

		const result = await runWithRetry(
			async () => {
				if (enableStreaming) {
					// stream only when we know we won't retry
					return await doAttempt((d) => {
						streamed += d;
						process.stdout.write(d);
					});
				}
				// non-streamed single shot
				return await doAttempt(undefined);
			},
			{
				retries,
				backoffMs,
				jitterPct,
				timeoutMs,
				extraMalformedRetry: true,
			}
		);

		// Persist single-turn session if requested
		if (opts.save) {
			const { saveSessionFromAsk } = await import('@sessions/store');
			saveSessionFromAsk({
				name: opts.save,
				prompt,
				answer: result.answer,
				model: result.model,
				profile: opts.profileFlag,
				usage: result.usage ?? null,
				startedAt,
				endedAt: startedAt + (result.timing?.elapsedMs ?? 0),
			});
		}

		if (wantJson) {
			const out = formatAskJsonOk(result);
			process.stdout.write(`${JSON.stringify(out)}\n`);
			return 0;
		}

		if (enableStreaming && streamed.length > 0) {
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

export function registerAskCommand(program: Command): void {
	const cmd = program
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
		.option('--save <name>', 'Save this turn as a session under <name>')
		.option('--meta', 'Print model + elapsed timing to stderr')
		// reliability
		.option('--retries <n>', 'Retries on 429/5xx/timeout (default 2)')
		.option('--backoff <ms>', 'Base backoff in ms (default 500)')
		.option('--jitter <0..1>', 'Jitter percentage (default 0.2)')
		.option('--timeout <ms>', 'Per-attempt timeout in ms');

	cmd.action(async (prompt: string, flags: Record<string, unknown>) => {
		const code = await handleAskCommand({
			prompt,
			modelFlag: toOpt(flags.model),
			profileFlag: toOpt(flags.profile),
			save: toOpt(flags.save),
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
			// reliability
			retries: toInt(flags.retries),
			backoffMs: toInt(flags.backoff),
			jitterPct: toFloat(flags.jitter),
			timeoutMs: toInt(flags.timeout),
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
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function toFloat(v: unknown): number | undefined {
	const n =
		typeof v === 'string'
			? Number.parseFloat(v)
			: typeof v === 'number'
				? v
				: Number.NaN;
	return Number.isFinite(n) ? n : undefined;
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
function clampInt(
	n: unknown | undefined,
	min: number,
	max: number,
	def: number
): number {
	const v =
		typeof n === 'number'
			? n
			: typeof n === 'string'
				? Number.parseInt(n, 10)
				: Number.NaN;
	if (!Number.isFinite(v)) {
		return def;
	}
	return Math.max(min, Math.min(max, Math.floor(v)));
}
function clampFloat(
	n: unknown | undefined,
	min: number,
	max: number,
	def: number
): number {
	const v =
		typeof n === 'number'
			? n
			: typeof n === 'string'
				? Number.parseFloat(n)
				: Number.NaN;
	if (!Number.isFinite(v)) {
		return def;
	}
	return Math.max(min, Math.min(max, v));
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

type RetryOpts = {
	retries: number;
	backoffMs: number;
	jitterPct: number;
	timeoutMs?: number;
	extraMalformedRetry?: boolean;
};
async function runWithRetry<T>(
	fn: () => Promise<T>,
	ro: RetryOpts
): Promise<T> {
	let tries = 0;
	let retryCount = 0; // counts only scheduled retries
	let usedMalformedBonus = false;

	while (true) {
		tries++;
		try {
			const p = ro.timeoutMs ? withTimeout(fn(), ro.timeoutMs) : fn();
			return await p;
		} catch (e) {
			const malformed = isMalformedError(e);
			const retryable = malformed || isRetryable(e);
			const canUseBonus =
				malformed &&
				ro.extraMalformedRetry === true &&
				!usedMalformedBonus;

			let waitMs = 0;
			if (canUseBonus) {
				// immediate extra retry with NO backoff (important for tests using fake timers)
				usedMalformedBonus = true;
				retryCount++;
			} else if (retryable && retryCount < ro.retries) {
				retryCount++;
				waitMs = backoffDelay(retryCount, ro.backoffMs, ro.jitterPct);
			} else {
				throw e;
			}

			if (waitMs > 0) {
				await sleep(waitMs);
			}
		}
	}
}

function isRetryable(e: unknown): boolean {
	// ProviderError with status 429/5xx
	if (isProviderError(e)) {
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const status = (e as any).status as number | undefined;
		if (status === 429) {
			return true;
		}
		if (typeof status === 'number' && status >= 500 && status <= 599) {
			return true;
		}
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		const code = (e as any).code as string | undefined;
		if (code && /rate[_-]?limit|overloaded/i.test(code)) {
			return true;
		}
	}
	// Timeout marker or generic status on thrown object
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const any = e as any;
	if (any && any.code === 'E_TIMEOUT') {
		return true;
	}
	const st = any?.status as number | undefined;
	if (st === 429 || (st && st >= 500 && st <= 599)) {
		return true;
	}
	return false;
}

function isMalformedError(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : e ? String(e) : '';
	return /malformed|invalid|parse|json/i.test(msg);
}

function backoffDelay(retryIndex: number, base: number, jitterPct: number) {
	// retryIndex starts at 1 for the first retry
	const pure = base * 2 ** Math.max(0, retryIndex - 1);
	if (!jitterPct) {
		return pure;
	}
	const j = pure * jitterPct;
	// random in [pure - j, pure + j]
	return pure - j + Math.random() * (2 * j);
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	let to: NodeJS.Timeout | null = null;
	try {
		return await Promise.race<T>([
			p,
			new Promise<T>((_res, rej) => {
				to = setTimeout(() => {
					const err = new Error(`timeout after ${ms}ms`);
					// mark so isRetryable handles it
					// biome-ignore lint/suspicious/noExplicitAny: tbd
					(err as any).code = 'E_TIMEOUT';
					rej(err);
				}, ms);
			}),
		]);
	} finally {
		if (to) {
			clearTimeout(to);
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
