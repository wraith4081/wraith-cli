import { describe, expect, it, vi } from 'vitest';
import { PanelRegistry } from '../../core/panel/index.js';
import { initOnLaunch } from '../../core/startup/initializer.js';

function makePanelRegistry() {
	const reg = new PanelRegistry();
	const chat = {
		isOpen: vi.fn(() => false),
		open: vi.fn(async () => {
			//
		}),
		close: vi.fn(async () => {
			//
		}),
		toggle: vi.fn(async () => {
			//
		}),
		focus: vi.fn(async () => {
			//
		}),
	};
	reg.register('chat', chat, ['c']);
	return { reg, chat } as const;
}

describe('StartupInitializer', () => {
	it('always opens chat on startup and focuses when no deep link', async () => {
		const { reg, chat } = makePanelRegistry();
		await initOnLaunch(reg);
		expect(chat.open).toHaveBeenCalledTimes(1);
		expect(chat.focus).toHaveBeenCalledTimes(1);
	});

	it('opens chat but does not steal focus when deep link provided', async () => {
		const { reg, chat } = makePanelRegistry();
		await initOnLaunch(reg, { deepLinkTarget: 'specs' });
		expect(chat.open).toHaveBeenCalledTimes(1);
		expect(chat.focus).toHaveBeenCalledTimes(0);
	});

	it('is non-blocking if chat panel is missing', async () => {
		const reg = new PanelRegistry();
		// No chat registered; should not throw
		await expect(initOnLaunch(reg)).resolves.toBeUndefined();
	});
});
