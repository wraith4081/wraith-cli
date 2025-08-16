import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@util/self-update', () => {
	return {
		selfUpdate: vi.fn().mockResolvedValue({
			updated: false,
			manual: true,
			message:
				'You are running via Bun; build or install a compiled binary.',
		}),
	};
});

import { registerSelfUpdateCommand } from '@cli/commands/self-update';
import { selfUpdate } from '@util/self-update';

describe('cli self-update command', () => {
	it('prints updater message and does not exit', async () => {
		const program = new Command();
		registerSelfUpdateCommand(program);

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
			// ignore
		});
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {
			// ignore
		});
		program.exitOverride();

		// With { from: 'user' }, pass only the user-entered tokens (no "node ai")
		await program.parseAsync(['self-update'], { from: 'user' });

		expect(selfUpdate).toHaveBeenCalledTimes(1);
		expect(logSpy).toHaveBeenCalled();
		const lastMsg = (logSpy.mock.calls.at(-1)?.[0] ?? '') as string;
		expect(lastMsg.toLowerCase()).toContain('compiled binary');

		logSpy.mockRestore();
		errSpy.mockRestore();
	});

	it('passes through --dry-run to updater', async () => {
		const program = new Command();
		registerSelfUpdateCommand(program);
		program.exitOverride();

		await program.parseAsync(['self-update', '--dry-run'], {
			from: 'user',
		});

		// Don't overfit on all args; just ensure dryRun flows through.
		expect(selfUpdate).toHaveBeenCalledWith(
			expect.objectContaining({ dryRun: true })
		);
	});
});
