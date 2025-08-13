import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock readline to send "/exit" immediately so chat exits without a turn.
vi.mock('node:readline', () => {
	return {
		default: {},
		createInterface: () => {
			const onClose: (() => void) | null = null;
			return {
				question: (_prompt: string, cb: (ans: string) => void) => {
					// Immediately exit
					cb('/exit');
				},
				close: () => {
					// biome-ignore lint/suspicious/noExplicitAny: test
					(onClose as any)?.();
				},
				on: (_ev: string, _fn: () => void) => {
					//
				},
			};
		},
	};
});

// Mock orchestrator chat session
vi.mock('@core/orchestrator', () => {
	return {
		startChatSession: vi.fn().mockReturnValue({
			model: 'test-model',
			content: '',
			profile: 'dev',
			addUser: (_: string) => {
				//
			},
			runAssistant: async () => ({
				content: 'hello',
				aborted: false,
				notices: [],
			}),
		}),
	};
});

// SUT
import { handleChatCommand } from '@cli/commands/chat';

function spyStdout() {
	const spy = vi
		.spyOn(process.stdout, 'write')
		.mockImplementation(() => true);
	return spy;
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('chat CLI – banner & render flag', () => {
	it('prints startup banner with render mode and exits on /exit', async () => {
		const out = spyStdout();

		const code = await handleChatCommand({
			modelFlag: 'm',
			profileFlag: 'p',
			render: 'ansi',
		});

		expect(code).toBe(0);
		const printed = out.mock.calls.map((c) => String(c[0])).join('');
		expect(printed).toContain('chat started');
		expect(printed).toContain(
			'(model: test-model, profile: dev, render: ansi)'
		);
		expect(printed).toContain('Type /exit to quit.');
	});
});
