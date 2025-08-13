import { formatAskJsonErr, formatAskJsonOk } from '@cli/commands/ask';
import type { AskResult } from '@core/orchestrator';
import { ProviderError } from '@provider/types';
import { describe, expect, it } from 'vitest';

describe('ask --json formatting', () => {
	it('formats success JSON with ok=true', () => {
		const fake: AskResult = {
			answer: 'Hello!',
			model: 'gpt-4o-mini',
			usage: { promptTokens: 10, completionTokens: 3, totalTokens: 13 },
			timing: { startedAt: 1000, elapsedMs: 25 },
		};
		const out = formatAskJsonOk(fake);
		expect(out.ok).toBe(true);
		expect(out.answer).toBe('Hello!');
		expect(out.model).toBe('gpt-4o-mini');
		expect(out.usage?.totalTokens).toBe(13);
		expect(out.timing.elapsedMs).toBe(25);
	});

	it('formats error JSON with provider metadata', () => {
		const startedAt = Date.now() - 5;
		const err = new ProviderError('E_AUTH', 'Missing key', { status: 401 });
		const out = formatAskJsonErr(err, startedAt);
		expect(out.ok).toBe(false);
		expect(out.error?.code).toBe('E_AUTH');
		expect(out.error?.status).toBe(401);
		expect(out.error?.message).toMatch(/Missing key/);
		expect(out.timing.elapsedMs).toBeGreaterThanOrEqual(0);
	});
});
