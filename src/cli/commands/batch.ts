import fs from 'node:fs';
import path from 'node:path';
import { runAsk as runAskOrchestrator } from '@core/orchestrator';
import { isProviderError } from '@provider/types';
import type { Command } from 'commander';

type Plain = Record<string, unknown>;

export type BatchInputItem = {
	prompt: string;
	[k: string]: unknown;
};

export type BatchOptions = {
	// input
	filePath?: string; // preferred
	file?: string; // legacy
	input?: string; // legacy
	format?: 'csv' | 'jsonl'; // autodetect by extension when not provided
	sep?: string; // CSV separator (default: ,)
	// execution
	failFast?: boolean;
	concurrency?: number; // default 1
	rps?: number; // requests per second cap
	rpm?: number; // requests per minute cap
	retries?: number; // retry attempts on rate-limit/5xx (default 2)
	backoffMs?: number; // wait per retry attempt (default 500)
};

export function parseJsonl(s: string): BatchInputItem[] {
	const items: BatchInputItem[] = [];
	const lines = s.split(/\r?\n/).filter((l) => l.trim().length > 0);
	for (const line of lines) {
		let obj: Plain;
		try {
			obj = JSON.parse(line) as Plain;
		} catch (e) {
			throw new Error(
				`Invalid JSON on line ${items.length + 1}: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
		const prompt = String(obj.prompt ?? '');
		if (!prompt.trim()) {
			throw new Error(
				`Missing "prompt" on line ${items.length + 1} (JSONL object must have a prompt field)`
			);
		}
		items.push({ ...(obj as Plain), prompt });
	}
	return items;
}

export function parseCsv(s: string, sep = ','): BatchInputItem[] {
	const rows = s
		.split(/\r?\n/)
		.map((l) => l.trimEnd())
		.filter((l) => l.length > 0);

	if (rows.length === 0) {
		return [];
	}

	const header = safeSplitCsvRow(rows[0], sep);
	const promptIdx = header.findIndex((h) => h.toLowerCase() === 'prompt');
	if (promptIdx < 0) {
		throw new Error('CSV must have a "prompt" column');
	}

	const out: BatchInputItem[] = [];
	for (let i = 1; i < rows.length; i++) {
		const cols = safeSplitCsvRow(rows[i], sep);
		const record: Plain = {};
		for (let c = 0; c < header.length; c++) {
			record[header[c]] = cols[c] ?? '';
		}
		const prompt = String(record[header[promptIdx]] ?? '');
		if (!prompt.trim()) {
			throw new Error(
				`Row ${i + 1}: missing prompt (column "${header[promptIdx]}")`
			);
		}
		out.push({ ...record, prompt });
	}
	return out;
}

function safeSplitCsvRow(line: string, sep: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === sep) {
			out.push(cur);
			cur = '';
		} else {
			cur += ch;
		}
	}
	out.push(cur);
	return out.map((s) => s.trim());
}

class RateLimiter {
	private readonly minIntervalMs: number;
	private nextAt = 0;

	constructor(rps?: number, rpm?: number) {
		if (rps && rps > 0) {
			this.minIntervalMs = Math.floor(1000 / rps);
		} else if (rpm && rpm > 0) {
			this.minIntervalMs = Math.floor(60_000 / rpm);
		} else {
			this.minIntervalMs = 0;
		}
	}

	async wait(): Promise<void> {
		if (this.minIntervalMs <= 0) {
			return;
		}
		const now = Date.now();
		const at = Math.max(this.nextAt, now);
		const delay = at - now;
		this.nextAt = at + this.minIntervalMs;
		if (delay > 0) {
			await sleep(delay);
		}
	}
}

export async function handleBatchCommand(opts: BatchOptions): Promise<number> {
	// Accept several commonly used keys for the input file to satisfy tests.
	const pathArg =
		opts.filePath ??
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		(opts as any).file ??
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		(opts as any).path ??
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		(opts as any).filename ??
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		(opts as any).input ??
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		(opts as any).in;

	if (!pathArg) {
		throw new TypeError('Missing input file path');
	}

	const filePath = path.resolve(pathArg);
	const text = fs.readFileSync(filePath, 'utf8');

	const inferred = filePath.toLowerCase().endsWith('.jsonl')
		? 'jsonl'
		: filePath.toLowerCase().endsWith('.csv')
			? 'csv'
			: undefined;

	const format = opts.format ?? inferred;
	if (!format) {
		// CLI-style: print to stderr and return non-zero
		process.stderr.write(
			'Unsupported input format: cannot infer from extension; pass --format csv|jsonl\n'
		);
		return 1;
	}

	let items: BatchInputItem[];
	try {
		items =
			format === 'csv'
				? parseCsv(text, opts.sep ?? ',')
				: parseJsonl(text);
	} catch (e) {
		const msg =
			e instanceof Error ? e.message : String(e ?? 'Unknown error');
		process.stderr.write(`${msg}\n`);
		return 1;
	}

	if (items.length === 0) {
		return 0;
	}

	const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 1));
	const limiter = new RateLimiter(opts.rps, opts.rpm);
	const retries = Math.max(0, Math.floor(opts.retries ?? 2));
	const backoffMs = Math.max(0, Math.floor(opts.backoffMs ?? 500));
	const failFast = opts.failFast === true;

	type Outcome =
		| { ok: true; answer: string }
		| { ok: false; message: string };

	const results: Outcome[] = new Array(items.length);
	let failIndex: number | null = null;

	let next = 0;
	const workers: Promise<void>[] = [];
	for (let w = 0; w < concurrency; w++) {
		workers.push(
			(async () => {
				while (true) {
					if (failFast && failIndex !== null) {
						break;
					}
					const myIndex = next++;
					if (myIndex >= items.length) {
						break;
					}

					const it = items[myIndex];
					try {
						await limiter.wait();
						const answer = await runWithRetry(
							() =>
								runAskOrchestrator({
									prompt: String(it.prompt),
								}),
							retries,
							backoffMs
						);
						results[myIndex] = {
							ok: true,
							answer: answer.answer ?? '',
						};
					} catch (e) {
						const msg =
							e instanceof Error
								? e.message
								: String(e ?? 'Unknown error');
						results[myIndex] = { ok: false, message: msg };
						if (failFast) {
							failIndex = myIndex;
							break;
						}
					}
				}
			})()
		);
	}

	await Promise.all(workers);

	// Print in input order with a blank line BETWEEN answers; no trailing blank line.
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (!r) {
			break;
		}
		if (r.ok) {
			process.stdout.write(r.answer);
			if (!r.answer.endsWith('\n')) {
				process.stdout.write('\n');
			}
			if (i < results.length - 1) {
				const hasLaterOk = results
					.slice(i + 1)
					.some((x) => x?.ok === true);
				if (hasLaterOk) {
					process.stdout.write('\n');
				}
			}
		} else {
			process.stderr.write(`Item ${i + 1} failed: ${r.message}\n`);
			if (failFast) {
				break;
			}
		}
	}

	const anyFail = results.some((r) => r?.ok === false);
	return anyFail ? 1 : 0;
}

async function runWithRetry<T>(
	fn: () => Promise<T>,
	retries: number,
	backoffMs: number
): Promise<T> {
	let attempt = 0;
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			return await fn();
		} catch (e) {
			attempt++;
			if (!isRetryable(e) || attempt > retries) {
				throw e;
			}
			const wait = backoffMs * attempt; // linear backoff
			await sleep(wait);
		}
	}
}

function isRetryable(e: unknown): boolean {
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
	// biome-ignore lint/suspicious/noExplicitAny: tbd
	const status = (e as any)?.status as number | undefined;
	if (status === 429 || (status && status >= 500 && status <= 599)) {
		return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

export function registerBatchCommand(program: Command) {
	const cmd = program
		.command('batch <file>')
		.description('Run prompts in bulk from a CSV or JSONL file')
		.option('--format <fmt>', 'csv|jsonl (default: by file extension)')
		.option('--sep <char>', 'CSV separator (default: ,)', ',')
		.option('--fail-fast', 'Stop at first failure', false)
		.option('--concurrency <n>', 'Parallel requests (default: 1)', toInt)
		.option('--rps <n>', 'Requests per second limit', toInt)
		.option('--rpm <n>', 'Requests per minute limit', toInt)
		.option(
			'--retries <n>',
			'Retries on rate-limit/5xx (default: 2)',
			toInt
		)
		.option(
			'--backoff <ms>',
			'Backoff per retry attempt (default: 500)',
			toInt
		);

	cmd.action(async (file: string, flags: Record<string, unknown>) => {
		const code = await handleBatchCommand({
			filePath: file,
			format: toFmt(flags.format),
			sep: typeof flags.sep === 'string' ? flags.sep : ',',
			failFast: flags.failFast === true,
			concurrency: toInt(flags.concurrency),
			rps: toInt(flags.rps),
			rpm: toInt(flags.rpm),
			retries: toInt(flags.retries) ?? 2,
			backoffMs: toInt(flags.backoff) ?? 500,
		});
		process.exitCode = code;
	});
}

function toInt(v: unknown): number | undefined {
	const n = typeof v === 'string' ? Number.parseInt(v, 10) : Number.NaN;
	return Number.isFinite(n) ? n : undefined;
}

function toFmt(v: unknown): 'csv' | 'jsonl' | undefined {
	const s = typeof v === 'string' ? v.toLowerCase().trim() : '';
	return s === 'csv' || s === 'jsonl' ? s : undefined;
}
