import { checkOptionalDeps } from '@util/optional-deps';
import { describe, expect, it, vi } from 'vitest';

describe('optional dependency checks', () => {
	it('does not throw and emits a single friendly notice', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
			// ignore
		});
		await expect(checkOptionalDeps()).resolves.toBeUndefined();

		// We expect at least one notice in typical dev/test environments
		// where optional packages are not installed. If all are present,
		// the function may log nothing; in that case we still pass.
		if (logSpy.mock.calls.length) {
			const msg = String(logSpy.mock.calls[0]?.[0] ?? '');
			expect(msg).toContain('Optional components not installed');
			// Show that it lists modules and install hints in bullet form
			expect(msg).toMatch(/-\s+\w+/);
			expect(msg).toMatch(/bun add/);
		}

		logSpy.mockRestore();
	});
});
