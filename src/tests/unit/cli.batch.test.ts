import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from 'vitest';

// Mock the orchestrator so batch doesn't call a real provider
vi.mock('@core/orchestrator', () => {
	return {
		runAsk: vi.fn(),
	};
});

import { handleBatchCommand } from '@cli/commands/batch';
import { runAsk } from '@core/orchestrator';

function tmpFile(name: string, contents: string): string {
	const f = path.join(os.tmpdir(), `wraith-batch-${Date.now()}-${name}`);
	fs.writeFileSync(f, contents, 'utf8');
	return f;
}

function captureStd(): {
	out: string[];
	err: string[];
	restore: () => void;
} {
	const out: string[] = [];
	const err: string[] = [];
	const outSpy = vi
		.spyOn(process.stdout, 'write')
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		.mockImplementation((chunk: any) => {
			out.push(String(chunk));
			return true;
		});
	const errSpy = vi
		.spyOn(process.stderr, 'write')
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		.mockImplementation((chunk: any) => {
			err.push(String(chunk));
			return true;
		});
	return {
		out,
		err,
		restore: () => {
			outSpy.mockRestore();
			errSpy.mockRestore();
		},
	};
}

describe('cli/batch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.resetAllMocks();
	});

	it('processes JSONL sequentially and prints answers separated by a blank line', async () => {
		const file = tmpFile(
			'items.jsonl',
			[
				JSON.stringify({ prompt: 'First?' }),
				JSON.stringify({ prompt: 'Second?' }),
				'',
			].join('\n')
		);

		(runAsk as unknown as Mock).mockImplementation(
			(opts: { prompt: string }) => {
				const out = opts.prompt === 'First?' ? 'ONE' : 'TWO';
				return {
					answer: out,
					model: 'mock',
					timing: { startedAt: 0, elapsedMs: 0 },
				};
			}
		);

		const cap = captureStd();
		const code = await handleBatchCommand({ input: file, failFast: false });
		cap.restore();

		expect(code).toBe(0);
		const printed = cap.out.join('');
		expect(printed).toMatch(/ONE\r?\n\r?\nTWO\r?\n$/);
		expect((runAsk as Mock).mock.calls.length).toBe(2);
	});

	it('processes CSV with quoted values (including commas and escaped quotes)', async () => {
		const csv = [
			'prompt,meta',
			'"Hello, world!","a,b,c"',
			'"He said ""hi""","quote"',
			'',
		].join('\n');
		const file = tmpFile('items.csv', csv);

		(runAsk as unknown as Mock).mockImplementationOnce(() => {
			return {
				answer: 'A',
				model: 'mock',
				timing: { startedAt: 0, elapsedMs: 0 },
			};
		});
		(runAsk as unknown as Mock).mockImplementationOnce(() => {
			return {
				answer: 'B',
				model: 'mock',
				timing: { startedAt: 0, elapsedMs: 0 },
			};
		});

		const cap = captureStd();
		const code = await handleBatchCommand({ input: file });
		cap.restore();

		expect(code).toBe(0);
		const printed = cap.out.join('');
		expect(printed).toMatch(/A\r?\n\r?\nB\r?\n$/);
		expect((runAsk as Mock).mock.calls.length).toBe(2);
	});

	it('errors if CSV lacks a "prompt" column', async () => {
		const file = tmpFile('bad.csv', ['text,value', 'hello,1'].join('\n'));
		const cap = captureStd();
		const code = await handleBatchCommand({ input: file });
		cap.restore();

		expect(code).toBe(1);
		expect(cap.err.join('')).toMatch(/CSV must have a "prompt" column/);
		expect((runAsk as Mock).mock.calls.length).toBe(0);
	});

	it('errors on invalid JSONL', async () => {
		const file = tmpFile(
			'bad.jsonl',
			['{"prompt":"ok"}', '{bad json}'].join('\n')
		);
		const cap = captureStd();
		const code = await handleBatchCommand({ input: file });
		cap.restore();

		expect(code).toBe(1);
		expect(cap.err.join('')).toMatch(/Invalid JSON on line 2/);
		expect((runAsk as Mock).mock.calls.length).toBe(0);
	});

	it('continues after an item failure unless --fail-fast is set', async () => {
		const file = tmpFile(
			'items.jsonl',
			[
				JSON.stringify({ prompt: 'one' }),
				JSON.stringify({ prompt: 'two' }),
				JSON.stringify({ prompt: 'three' }),
			].join('\n')
		);

		let call = 0;
		(runAsk as unknown as Mock).mockImplementation(
			(opts: { prompt: string }) => {
				call++;
				if (call === 2) {
					throw new Error('boom');
				}
				return {
					answer: opts.prompt.toUpperCase(),
					model: 'mock',
					timing: { startedAt: 0, elapsedMs: 0 },
				};
			}
		);

		const cap = captureStd();
		const code = await handleBatchCommand({ input: file, failFast: false });
		cap.restore();

		// Should finish all 3 with one failure => exit code 1
		expect(code).toBe(1);
		const out = cap.out.join('');
		expect(out).toMatch(/ONE\r?\n/);
		expect(out).toMatch(/THREE\r?\n/);
		// Stderr has the failure message
		expect(cap.err.join('')).toMatch(/Item 2 failed: boom/);
		expect((runAsk as Mock).mock.calls.length).toBe(3);
	});

	it('stops on first failure with --fail-fast (no trailing blank separator)', async () => {
		const file = tmpFile(
			'items.jsonl',
			[
				JSON.stringify({ prompt: 'alpha' }),
				JSON.stringify({ prompt: 'beta' }),
			].join('\n')
		);

		(runAsk as unknown as Mock)
			.mockImplementationOnce(() => {
				return {
					answer: 'OK',
					model: 'mock',
					timing: { startedAt: 0, elapsedMs: 0 },
				};
			})
			.mockImplementationOnce(() => {
				throw new Error('nope');
			});

		const cap = captureStd();
		const code = await handleBatchCommand({ input: file, failFast: true });
		cap.restore();

		expect(code).toBe(1);
		const out = cap.out.join('');
		// printed only first answer; no extra blank line added
		expect(out).toMatch(/OK\r?\n$/);
		expect(cap.err.join('')).toMatch(/Item 2 failed: nope/);
		expect((runAsk as Mock).mock.calls.length).toBe(2);
	});

	it('errors on unsupported file extension', async () => {
		const file = tmpFile('items.txt', 'anything');
		const cap = captureStd();
		const code = await handleBatchCommand({ input: file });
		cap.restore();

		expect(code).toBe(1);
		expect(cap.err.join('')).toMatch(/Unsupported input format/);
		expect((runAsk as Mock).mock.calls.length).toBe(0);
	});

	it('handles empty JSONL gracefully (no output, exit 0)', async () => {
		const file = tmpFile('empty.jsonl', '\n\n');
		const cap = captureStd();
		const code = await handleBatchCommand({ input: file });
		cap.restore();

		expect(code).toBe(0);
		expect(cap.out.join('')).toBe('');
		expect(cap.err.join('')).toBe('');
		expect((runAsk as Mock).mock.calls.length).toBe(0);
	});
});
