import { OpenAIProvider } from '@provider/openai';
import { ProviderError } from '@provider/types';
import { describe, expect, it } from 'vitest';

describe('OpenAIProvider', () => {
	it('throws E_AUTH when apiKey is missing/blank', () => {
		// Force using blank provided key to avoid relying on environment
		const create = () => new OpenAIProvider({ apiKey: '' });
		expect(create).toThrowError(ProviderError);
		try {
			create();
		} catch (e) {
			const err = e as ProviderError;
			expect(err.code).toBe('E_AUTH');
		}
	});
});
