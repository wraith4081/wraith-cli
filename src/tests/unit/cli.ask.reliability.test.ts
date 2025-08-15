// src/tests/unit/cli.ask.reliability.test.ts
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

import { handleAskCommand } from '@cli/commands/ask';
import { runAsk } from '@core/orchestrator';

function spyStdout() {
	return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

beforeEach(() => {
	(runAsk as unknown as Mock).mockReset();
});
afterEach(() => {
	vi.clearAllTimers();
	vi.restoreAllMocks();
});

describe('ask reliability', () => {
	it('retries with exponential backoff (no jitter)', async () => {
		// fail(500), fail(500), succeed
		(runAsk as unknown as Mock)
			.mockImplementationOnce(() => {
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				const e: any = new Error('srv');
				e.status = 500;
				throw e;
			})
			.mockImplementationOnce(() => {
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				const e: any = new Error('srv');
				e.status = 500;
				throw e;
			})
			.mockResolvedValueOnce({
				answer: 'OK',
				model: 'm',
				timing: { startedAt: 0, elapsedMs: 1 },
			});

		const out = spyStdout();

		const p = handleAskCommand({
			prompt: 'ping',
			render: 'plain',
			retries: 2,
			backoffMs: 100,
			jitterPct: 0,
		});

		// 1st backoff = 100ms; 2nd = 200ms
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(200);
		const code = await p;

		expect(code).toBe(0);
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(3);
		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		expect(printed).toMatch(/^OK\r?\n$/);
	});

	it('timeouts cause retry then success', async () => {
		// 1st attempt hangs (> timeout), 2nd returns
		(runAsk as unknown as Mock)
			.mockImplementationOnce(
				() =>
					new Promise(() => {
						/* never resolves */
					})
			)
			.mockResolvedValueOnce({
				answer: 'Y',
				model: 'm',
				timing: { startedAt: 0, elapsedMs: 1 },
			});

		const p = handleAskCommand({
			prompt: 'slow',
			render: 'plain',
			retries: 1,
			backoffMs: 10,
			jitterPct: 0,
			timeoutMs: 100,
		});

		await vi.advanceTimersByTimeAsync(100); // timeout #1
		await vi.advanceTimersByTimeAsync(10); // backoff
		const code = await p;

		expect(code).toBe(0);
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(2);
	});

	it('malformed provider data triggers one extra retry even when retries=0', async () => {
		(runAsk as unknown as Mock)
			.mockImplementationOnce(() => {
				throw new Error('malformed json');
			})
			.mockResolvedValueOnce({
				answer: 'OK',
				model: 'm',
				timing: { startedAt: 0, elapsedMs: 1 },
			});

		const code = await handleAskCommand({
			prompt: 'fix',
			render: 'plain',
			retries: 0,
			backoffMs: 1,
			jitterPct: 0,
		});

		expect(code).toBe(0);
		expect((runAsk as unknown as Mock).mock.calls.length).toBe(2);
	});

	it('emits JSON error envelope on timeout when --json is set', async () => {
		(runAsk as unknown as Mock).mockImplementationOnce(
			() =>
				new Promise(() => {
					//
				})
		);
		const out = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);

		const p = handleAskCommand({
			prompt: 'x',
			render: 'plain',
			json: true,
			retries: 0,
			timeoutMs: 50,
		});

		await vi.advanceTimersByTimeAsync(60);
		const code = await p;

		expect(code).toBe(1);
		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		const obj = JSON.parse(printed) as {
			ok: boolean;
			error: { message: string };
		};
		expect(obj.ok).toBe(false);
		expect(obj.error.message.toLowerCase()).toContain('timeout');
	});
});
