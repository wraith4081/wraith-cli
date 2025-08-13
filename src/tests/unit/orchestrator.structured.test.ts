import fs from 'node:fs';
import path from 'node:path';
import { runAskStructured } from '@core/structured';
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
	async embed() {
		return await Promise.resolve([]);
	}
	async streamChat(
		req: ChatRequest,
		_onDelta: (d: StreamDelta) => void
	): Promise<ChatResult> {
		// First attempt returns slightly off JSON, repair should fix.
		const last = req.messages.at(-1);
		const isRepair =
			typeof last?.content === 'string' &&
			/did not validate/i.test(last.content);
		const content = isRepair
			? `{"title":"Hello","count":2}`
			: `Here is your data: {"title":"Hello","count":"2"}`;
		return await Promise.resolve({ model: req.model, content });
	}
}

const schemaFile = path.join(process.cwd(), 'tmp.schema.json');

describe('runAskStructured', () => {
	it('validates and repairs to match schema', async () => {
		// simple schema
		fs.writeFileSync(
			schemaFile,
			JSON.stringify(
				{
					type: 'object',
					required: ['title', 'count'],
					properties: {
						title: { type: 'string' },
						count: { type: 'number' },
					},
					additionalProperties: false,
				},
				null,
				2
			),
			'utf8'
		);

		const res = await runAskStructured(
			{
				prompt: 'Give me an object with title + count',
				schemaPath: schemaFile,
				maxAttempts: 1,
			},
			{ provider: new MockProvider() }
		);

		expect(res.ok).toBe(true);
		expect(res.data).toEqual({ title: 'Hello', count: 2 });

		fs.unlinkSync(schemaFile);
	});
});
