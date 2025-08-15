// src/tests/unit/cli.batch.reliability.test.ts
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

vi.mock('@core/orchestrator', () => ({ runAsk: vi.fn() }));

import { handleBatchCommand } from '@cli/commands/batch';
import { runAsk } from '@core/orchestrator';

function tmpFile(name: string, contents: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wraith-reliab-'));
	const p = path.join(dir, name);
	fs.writeFileSync(p, contents, 'utf8');
	return p;
}
function captureStd() {
	const out: string[] = [];
	const err: string[] = [];
	const outSpy = vi
		.spyOn(process.stdout, 'write')
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		.mockImplementation((c: any) => {
			out.push(String(c));
			return true;
		});
	const errSpy = vi
		.spyOn(process.stderr, 'write')
		// biome-ignore lint/suspicious/noExplicitAny: tbd
		.mockImplementation((c: any) => {
			err.push(String(c));
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

beforeEach(() => {
	(runAsk as unknown as Mock).mockReset();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
});

describe('batch reliability', () => {
	it('malformed item gets one extra retry when retries=0', async () => {
		const file = tmpFile('one.jsonl', `{"prompt":"hello"}\n`);
		(runAsk as unknown as Mock)
			.mockImplementationOnce(() => {
				throw new Error('invalid json');
			})
			.mockResolvedValueOnce({ answer: 'OK' });

		const cap = captureStd();
		const p = handleBatchCommand({
			filePath: file,
			format: 'jsonl',
			retries: 0,
			backoffMs: 1,
			jitterPct: 0,
		});
		await vi.runAllTimersAsync();
		const code = await p;
		cap.restore();

		expect(code).toBe(0);
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(2);
		expect(cap.out.join('')).toMatch(/^OK\r?\n$/);
	});

	it('timeout then success (per-item)', async () => {
		const file = tmpFile('one.jsonl', `{"prompt":"slow"}\n`);
		(runAsk as unknown as Mock)
			.mockImplementationOnce(
				() =>
					new Promise(() => {
						//
					})
			) // will timeout
			.mockResolvedValueOnce({ answer: 'DONE' });

		const cap = captureStd();
		const p = handleBatchCommand({
			filePath: file,
			format: 'jsonl',
			retries: 1,
			backoffMs: 5,
			jitterPct: 0,
			timeoutMs: 50,
		});

		await vi.advanceTimersByTimeAsync(50); // timeout first try
		await vi.advanceTimersByTimeAsync(5); // backoff
		const code = await p;
		cap.restore();

		expect(code).toBe(0);
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(2);
		expect(cap.out.join('')).toMatch(/^DONE\r?\n$/);
	});

	it('SIGINT cancels further work and exits 1', async () => {
		const file = tmpFile(
			'three.jsonl',
			`{"prompt":"A"}\n{"prompt":"B"}\n{"prompt":"C"}\n`
		);
		// First item resolves after a bit; others would resolve immediately if scheduled
		(runAsk as unknown as Mock)
			.mockImplementationOnce(async () => {
				await vi.advanceTimersByTimeAsync(30);
				return { answer: 'A' };
			})
			.mockResolvedValue({ answer: 'X' });

		const cap = captureStd();
		const run = handleBatchCommand({
			filePath: file,
			format: 'jsonl',
			retries: 0,
			backoffMs: 0,
			concurrency: 1,
		});

		// Cancel while first is in-flight
		await vi.advanceTimersByTimeAsync(5);
		process.emit('SIGINT', 'SIGINT');

		await vi.runAllTimersAsync();
		const code = await run;
		cap.restore();

		expect(code).toBe(1);
		// Only first answer printed
		const printed = cap.out.join('');
		expect(printed).toMatch(/^A\r?\n$/);
		// Only first call happened (others were never scheduled)
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(1);
	});
});
