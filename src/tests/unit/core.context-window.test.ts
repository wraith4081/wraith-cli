import { fitMessagesToContext } from '@core/context-window';
import type { ChatMessage } from '@provider/types';
import { describe, expect, it } from 'vitest';

function msg(
	role: 'system' | 'user' | 'assistant',
	content: string
): ChatMessage {
	return { role, content };
}

describe('fitMessagesToContext', () => {
	it('keeps within budget and preserves system head when possible', () => {
		const messages: ChatMessage[] = [
			msg('system', 'you are helpful'),
			msg('user', 'a'.repeat(2000)),
			msg('assistant', 'b'.repeat(2000)),
			msg('user', 'c'.repeat(2000)),
			msg('assistant', 'd'.repeat(2000)),
		];

		// Force a tiny budget so pruning must happen (approx tokens ~ bytes/4)
		const {
			messages: bounded,
			notices,
			prunedCount,
		} = fitMessagesToContext(messages, {
			maxInputTokens: 800, // ~ 3200 bytes budget (ensures we drop some)
		});

		// Expect we kept the system message (if it fits) and the most recent turns
		expect(bounded[0]?.role).toBe('system');
		expect(prunedCount).toBeGreaterThan(0);
		expect(notices.length).toBe(1);
	});

	it('no change when under budget', () => {
		const messages: ChatMessage[] = [
			msg('system', 's'),
			msg('user', 'hi'),
			msg('assistant', 'hello'),
		];

		const r = fitMessagesToContext(messages, { maxInputTokens: 10_000 });
		expect(r.prunedCount).toBe(0);
		expect(r.messages.length).toBe(messages.length);
		expect(r.notices.length).toBe(0);
	});
});
