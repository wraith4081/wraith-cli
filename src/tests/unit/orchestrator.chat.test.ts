import { startChatSession } from '@core/orchestrator';
import type {
	ChatRequest,
	ChatResult,
	IProvider,
	StreamDelta,
} from '@provider/types';
import { describe, expect, it } from 'vitest';

class MockProvider implements IProvider {
	readonly name = 'openai' as const;

	async listModels() {
		return await Promise.resolve([]);
	}

	async streamChat(
		req: ChatRequest,
		onDelta: (d: StreamDelta) => void,
		signal?: AbortSignal
	): Promise<ChatResult> {
		const last = req.messages.at(-1);
		const text = last?.content ?? '';
		const tokens = `echo:${text}`.split('');
		for (const t of tokens) {
			if (signal?.aborted) {
				// simulate provider abort by throwing
				throw new Error('aborted');
			}
			onDelta({ content: t });
		}
		return await Promise.resolve({
			model: req.model,
			content: `echo:${text}`,
		});
	}

	async embed() {
		return await Promise.resolve([]);
	}
}

describe('startChatSession', () => {
	it('maintains history across turns and streams', async () => {
		const sess = startChatSession({}, { provider: new MockProvider() });
		expect(sess.history[0]?.role).toBe('system');

		sess.addUser('hello');
		const r1 = await sess.runAssistant(() => {
			//
		});
		expect(r1.content).toContain('echo:hello');
		expect(sess.history.at(-1)?.role).toBe('assistant');

		sess.addUser('again');
		const r2 = await sess.runAssistant(() => {
			//
		});
		expect(r2.content).toContain('echo:again');
		expect(sess.history.filter((m) => m.role === 'user').length).toBe(2);
	});

	it('records partial content when aborted', async () => {
		const sess = startChatSession({}, { provider: new MockProvider() });
		sess.addUser('interrupt');

		const ctrl = new AbortController();
		let seen = '';
		const p = sess.runAssistant((d) => {
			seen += d;
			if (seen.length > 5) {
				ctrl.abort();
			}
		}, ctrl.signal);

		const r = await p;
		expect(r.aborted).toBe(true);
		expect(r.content.length).toBeGreaterThan(0);
		// assistant partial persisted into history
		expect(sess.history.at(-1)?.role).toBe('assistant');
		expect((sess.history.at(-1)?.content ?? '').length).toBe(
			r.content.length
		);
	});
});
