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

vi.useFakeTimers();

vi.mock('@core/orchestrator', () => {
	return {
		runAsk: vi.fn(),
	};
});

// NOTE: other tests import this module via @cli/*, not @/*
import { handleBatchCommand } from '@cli/commands/batch';
import { runAsk } from '@core/orchestrator';

function tmpFile(name: string, content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-batch-'));
	const p = path.join(dir, name);
	fs.writeFileSync(p, content, 'utf8');
	return p;
}

describe('cli/batch concurrency & retry', () => {
	const outSpy = vi
		.spyOn(process.stdout, 'write')
		.mockImplementation(() => true);
	const errSpy = vi
		.spyOn(process.stderr, 'write')
		.mockImplementation(() => true);

	beforeEach(() => {
		outSpy.mockClear();
		errSpy.mockClear();
		(runAsk as Mock).mockReset();
	});

	afterEach(() => {
		vi.clearAllTimers();
	});

	it('runs with concurrency>1 but prints answers in input order', async () => {
		const jsonl = `{"prompt":"A"}\n{"prompt":"B"}\n{"prompt":"C"}\n`;
		const file = tmpFile('in.jsonl', jsonl);

		(runAsk as Mock)
			.mockImplementationOnce(async () => {
				await vi.advanceTimersByTimeAsync(30);
				return { answer: 'A' };
			})
			.mockImplementationOnce(async () => {
				await vi.advanceTimersByTimeAsync(10);
				return { answer: 'B' };
			})
			.mockImplementationOnce(async () => {
				await vi.advanceTimersByTimeAsync(5);
				return { answer: 'C' };
			});

		const p = handleBatchCommand({
			file,
			format: 'jsonl',
			concurrency: 2,
			retries: 0,
		});

		await vi.runAllTimersAsync();
		await p;

		const out = outSpy.mock.calls.map((c) => String(c[0])).join('');
		expect(out).toMatch(/^A\r?\n\r?\nB\r?\n\r?\nC\r?\n$/);
		expect(errSpy.mock.calls.length).toBe(0);
		expect((runAsk as Mock).mock.calls.length).toBe(3);
	});

	it('retries on rate limit once then succeeds', async () => {
		const jsonl = `{"prompt":"Hello"}\n`;
		const file = tmpFile('one.jsonl', jsonl);

		(runAsk as Mock)
			.mockImplementationOnce(() => {
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				const e: any = new Error('Too many requests');
				e.status = 429;
				e.code = 'rate_limit';
				throw e;
			})
			.mockImplementationOnce(() => {
				return { answer: 'OK' };
			});

		const p = handleBatchCommand({
			file,
			format: 'jsonl',
			retries: 1,
			backoffMs: 100,
		});

		await vi.advanceTimersByTimeAsync(100);
		await p;

		const out = outSpy.mock.calls.map((c) => String(c[0])).join('');
		expect(out).toMatch(/^OK\r?\n$/);
		expect(errSpy.mock.calls.length).toBe(0);
		expect((runAsk as Mock).mock.calls.length).toBe(2);
	});

	it('rate limits with rps=1 even if concurrency=3 (sanity: runs and prints twice)', async () => {
		const jsonl = `{"prompt":"P1"}\n{"prompt":"P2"}\n`;
		const file = tmpFile('twice.jsonl', jsonl);

		(runAsk as Mock).mockResolvedValue({ answer: 'X' });

		const p = handleBatchCommand({
			file,
			format: 'jsonl',
			concurrency: 3,
			rps: 1,
		});

		await vi.runAllTimersAsync();
		await p;

		const out = outSpy.mock.calls.map((c) => String(c[0])).join('');
		expect(out).toMatch(/^X\r?\n\r?\nX\r?\n$/);
	});
});
