import { describe, expect, it, vi } from 'vitest';
import { withPerfGuards } from '../../core/command/index.js';

function delay<T>(ms: number, value: T): Promise<T> {
	return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const makeCtx = (id: string, argIndex: number, prefix: string) => ({
	command: {
		id,
		handler: () => {
			//
		},
	},
	argIndex,
	prefix,
});

describe('Provider performance guards', () => {
	it('caches values within TTL and evicts after TTL', async () => {
		vi.useFakeTimers();
		let calls = 0;
		const base = vi.fn(() => {
			calls++;
			return delay(1, ['a', 'b']);
		});
		const guarded = withPerfGuards(base, { ttlMs: 1000, maxSize: 10 });

		const c1 = guarded(makeCtx('open', 0, 's'));
		vi.advanceTimersByTime(2);
		await expect(c1).resolves.toEqual(['a', 'b']);
		expect(calls).toBe(1);

		// second call within TTL uses cache
		const c2 = guarded(makeCtx('open', 0, 's'));
		await expect(c2).resolves.toEqual(['a', 'b']);
		expect(calls).toBe(1);

		// advance beyond TTL → re-fetch
		vi.advanceTimersByTime(1001);
		const c3 = guarded(makeCtx('open', 0, 's'));
		vi.advanceTimersByTime(2);
		await c3;
		expect(calls).toBe(2);

		vi.useRealTimers();
	});

	it('coalesces concurrent identical requests', async () => {
		let calls = 0;
		const base = vi.fn(() => {
			calls++;
			return delay(5, ['x']);
		});
		const guarded = withPerfGuards(base, { ttlMs: 1000 });

		const p1 = guarded(makeCtx('open', 0, 's'));
		const p2 = guarded(makeCtx('open', 0, 's'));
		const [a, b] = await Promise.all([p1, p2]);
		expect(a).toEqual(['x']);
		expect(b).toEqual(['x']);
		expect(calls).toBe(1);
	});
});
