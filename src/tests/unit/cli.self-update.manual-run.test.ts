import path from 'node:path';
import { selfUpdate } from '@util/self-update';
import { describe, expect, it } from 'vitest';

// This test validates the "not compiled" branch by simulating Bun runner.
// It stubs process.execPath's basename to "bun".
describe('selfUpdate manual branch when not a compiled binary', () => {
	it('returns manual=true and helpful message under Bun', async () => {
		const realExec = process.execPath;
		process.execPath = path.join(path.dirname(realExec), 'bun');
		const res = await selfUpdate({ dryRun: true }); // dryRun still allowed
		expect(res.manual).toBe(true);
		expect(res.message.toLowerCase()).toContain('bun');
		process.execPath = realExec;
	});
});
