import { runAsk } from '@core/orchestrator';
import type {
	ChatRequest,
	ChatResult,
	IProvider,
	StreamDelta,
} from '@provider/types';
import { describe, expect, it } from 'vitest';

class CaptureProvider implements IProvider {
	readonly name = 'openai' as const;
	lastReq: ChatRequest | null = null;
	async listModels() {
		return await Promise.resolve([]);
	}
	async embed() {
		return await Promise.resolve([]);
	}
	async streamChat(
		req: ChatRequest,
		_onDelta: (d: StreamDelta) => void
	): Promise<ChatResult> {
		this.lastReq = req;
		return await Promise.resolve({ model: req.model, content: 'ok' });
	}
}

describe('runAsk with overrides', () => {
	it('appends system override and injects instructions as first user msg', async () => {
		const p = new CaptureProvider();
		await runAsk(
			{
				prompt: 'MAIN',
				systemOverride: 'SYS_OVR',
				instructions: 'INSTR',
			},
			{ provider: p }
		);

		const msgs = p.lastReq?.messages ?? [];
		expect(msgs[0]?.role).toBe('system');
		expect(msgs[0]?.content ?? '').toMatch(/SYS_OVR/);

		// user instruction is present before the main prompt
		expect(msgs[1]?.role).toBe('user');
		expect(msgs[1]?.content ?? '').toMatch(/INSTR/);
		expect(msgs[2]?.role).toBe('user');
		expect(msgs[2]?.content ?? '').toBe('MAIN');
	});
});
