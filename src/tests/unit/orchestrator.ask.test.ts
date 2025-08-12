import { runAsk } from '@core/orchestrator';
import type { ChatResult, IProvider, StreamDelta } from '@provider/types';
import { describe, expect, it } from 'vitest';

class MockProvider implements IProvider {
	readonly name = 'openai' as const;
	constructor(
		private chunks: string[],
		private final?: Partial<ChatResult>
	) {}
	async listModels() {
		return await Promise.resolve([]);
	}
	async streamChat(
		_req: unknown,
		onDelta: (d: StreamDelta) => void,
		_signal?: AbortSignal
	): Promise<ChatResult> {
		for (const c of this.chunks) {
			onDelta({ content: c });
		}
		return await Promise.resolve({
			model: 'gpt-5',
			content: this.chunks.join(''),
			...this.final,
		});
	}
	async embed(texts: string[]): Promise<number[][]> {
		return await Promise.resolve(texts.map(() => [0, 1, 2]));
	}
}

describe('runAsk', () => {
	const cfg = {
		version: '1',
		defaults: { model: 'gpt-5' },
		models: {
			aliases: { fast: 'gpt-5' },
		},
	};

	it('returns accumulated answer and model', async () => {
		const provider = new MockProvider(['Hello', ' ', 'world']);
		const res = await runAsk(
			{ prompt: 'Say hello', modelFlag: 'fast' },
			{ provider, config: cfg }
		);
		expect(res.answer).toBe('Hello world');
		expect(res.model).toBe('gpt-5');
		expect(res.timing.elapsedMs).toBeGreaterThanOrEqual(0);
	});

	it('supports onDelta callback for streaming', async () => {
		const out: string[] = [];
		const provider = new MockProvider(['A', 'B', 'C']);
		const res = await runAsk(
			{ prompt: 'stream' },
			{ provider, config: cfg, onDelta: (s) => out.push(s) }
		);
		expect(out.join('')).toBe('ABC');
		expect(res.answer).toBe('ABC');
	});
});
