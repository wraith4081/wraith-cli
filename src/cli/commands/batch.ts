/** biome-ignore-all lint/suspicious/noConsole: CLI printing by design */

import fs from 'node:fs';
import path from 'node:path';
import { runAsk } from '@core/orchestrator';
import type { Command } from 'commander';

type BatchInputItem = { prompt: string; [k: string]: unknown };

function parseJsonl(s: string): BatchInputItem[] {
	const lines = s.split(/\r?\n/);
	const items: BatchInputItem[] = [];
	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}
		let obj: unknown;
		try {
			obj = JSON.parse(line);
		} catch (e) {
			throw new Error(
				`Invalid JSON on line ${items.length + 1}: ${
					e instanceof Error ? e.message : String(e)
				}`
			);
		}
		if (
			!obj ||
			typeof obj !== 'object' ||
			// biome-ignore lint/suspicious/noExplicitAny: tbd
			typeof (obj as any).prompt !== 'string'
		) {
			throw new Error(`Missing "prompt" on line ${items.length + 1}`);
		}
		items.push({ ...(obj as Record<string, unknown>) } as BatchInputItem);
	}
	return items;
}

function parseCsv(text: string): BatchInputItem[] {
	const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
	if (lines.length === 0) {
		return [];
	}

	const parseLine = (row: string): string[] => {
		const out: string[] = [];
		let cur = '';
		let i = 0;
		let inQ = false;
		while (i < row.length) {
			const ch = row[i];
			if (inQ) {
				if (ch === '"') {
					if (i + 1 < row.length && row[i + 1] === '"') {
						cur += '"';
						i += 2;
					} else {
						inQ = false;
						i++;
					}
				} else {
					cur += ch;
					i++;
				}
			} else if (ch === ',') {
				out.push(cur);
				cur = '';
				i++;
			} else if (ch === '"') {
				inQ = true;
				i++;
			} else {
				cur += ch;
				i++;
			}
		}
		out.push(cur);
		return out;
	};

	const header = parseLine(lines[0]).map((h) => h.trim());
	const promptIdx = header.findIndex((h) => h.toLowerCase() === 'prompt');
	if (promptIdx < 0) {
		throw new Error('CSV must have a "prompt" column');
	}

	const out: BatchInputItem[] = [];
	for (let li = 1; li < lines.length; li++) {
		const row = parseLine(lines[li]);
		if (row.every((c) => c.trim() === '')) {
			continue; // skip blank rows
		}
		const rec: Record<string, unknown> = {};
		for (let i = 0; i < header.length; i++) {
			rec[header[i]] = row[i] ?? '';
		}
		const prompt = String(rec[header[promptIdx]] ?? '');
		if (!prompt) {
			throw new Error(`Missing "prompt" on CSV line ${li + 1}`);
		}
		out.push({ ...rec, prompt });
	}
	return out;
}

function readBatchItems(filePath: string): BatchInputItem[] {
	const abs = path.resolve(filePath);
	const raw = fs.readFileSync(abs, 'utf8');
	const ext = path.extname(abs).toLowerCase();
	if (ext === '.jsonl' || ext === '.ndjson') {
		return parseJsonl(raw);
	}
	if (ext === '.csv') {
		return parseCsv(raw);
	}
	throw new Error(`Unsupported input format: ${ext || '(none)'}`);
}

export interface BatchCliOptions {
	input: string; // file path: .jsonl/.ndjson/.csv
	failFast?: boolean;
	modelFlag?: string;
	profileFlag?: string;
	systemOverride?: string;
	instructions?: string;
}

/**
 * Process batch input sequentially. Prints each answer to stdout.
 * - Exactly one newline after each printed answer.
 * - Exactly one blank line BETWEEN successful answers.
 * - No trailing blank separator.
 */
export async function handleBatchCommand(
	opts: BatchCliOptions
): Promise<number> {
	let items: BatchInputItem[];
	try {
		items = await readBatchItems(opts.input);
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		process.stderr.write(`${msg}\n`);
		return 1;
	}

	let printed = 0;
	let hadError = false;

	for (let i = 0; i < items.length; i++) {
		const it = items[i];

		try {
			const res = await runAsk(
				{
					prompt: it.prompt,
					modelFlag: opts.modelFlag,
					profileFlag: opts.profileFlag,
					systemOverride: opts.systemOverride,
					instructions: opts.instructions,
				},
				{}
			);

			// Normalize newlines and guarantee exactly one trailing newline.
			const sep = printed > 0 ? '\n' : '';
			let out = res.answer ?? '';
			out = out.replace(/\r\n/g, '\n').replace(/\n+$/, '');
			process.stdout.write(`${sep}${out}\n`);

			printed++;
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			process.stderr.write(`Item ${i + 1} failed: ${msg}\n`);
			hadError = true;
			if (opts.failFast) {
				return 1;
			}
			// No separator printed here; only once we have a next success.
		}
	}

	return hadError ? 1 : 0;
}

export function registerBatchCommand(program: Command): void {
	program
		.command('batch <input>')
		.description('Run prompts in batch from a JSONL/NDJSON or CSV file')
		.option('-f, --fail-fast', 'Stop on first failure', false)
		.option('-m, --model <modelId>', 'Override model for this run')
		.option('-p, --profile <name>', 'Use a profile (applies defaults)')
		.option('-S, --system <text>', 'Append system override to the run')
		.option(
			'-I, --instructions <text>',
			'Add persistent instructions for each item'
		)
		.action(
			async (
				input: string,
				cmd: {
					failFast?: boolean;
					model?: string;
					profile?: string;
					system?: string;
					instructions?: string;
				}
			) => {
				const code = await handleBatchCommand({
					input,
					failFast: !!cmd.failFast,
					modelFlag: cmd.model,
					profileFlag: cmd.profile,
					systemOverride: cmd.system,
					instructions: cmd.instructions,
				});
				// Let the top-level CLI decide process exit; set exitCode for safety.
				process.exitCode = code;
			}
		);
}
