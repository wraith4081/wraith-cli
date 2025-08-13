import { startChatSession } from '@core/orchestrator';
import type {
	ChatRequest,
	ChatResult,
	IProvider,
	StreamDelta,
} from '@provider/types';
import { describe, expect, it } from 'vitest';

class EchoProvider implements IProvider {
	readonly name = 'openai' as const;
	calls: ChatRequest[] = [];
	async listModels() {
		return await Promise.resolve([]);
	}
	async embed() {
		return await Promise.resolve([]);
	}
	async streamChat(
		req: ChatRequest,
		onDelta: (d: StreamDelta) => void
	): Promise<ChatResult> {
		this.calls.push(req);
		onDelta({ content: 'x' });
		return await Promise.resolve({ model: req.model, content: 'x' });
	}
}

describe('startChatSession with overrides', () => {
	it('persists system override + instructions across turns', async () => {
		const prov = new EchoProvider();
		const sess = startChatSession(
			{ systemOverride: 'OVR', instructions: 'INST' },
			{ provider: prov }
		);

		// first turn
		sess.addUser('hello');
		await sess.runAssistant(() => {
			//
		});
		const first = prov.calls[0];
		expect(first.messages[0]?.role).toBe('system');
		expect(first.messages[0]?.content).toMatch(/OVR/);
		expect(first.messages[1]?.role).toBe('user'); // instructions
		expect(first.messages[1]?.content).toMatch(/INST/);

		// second turn should still include the instruction earlier in history
		sess.addUser('again');
		await sess.runAssistant(() => {
			//
		});
		const second = prov.calls[1];
		const hasInstruction = second.messages.some(
			(m) => m.role === 'user' && /INST/.test(m.content)
		);
		expect(hasInstruction).toBe(true);
	});
});
