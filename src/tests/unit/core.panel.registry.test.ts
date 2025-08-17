import { describe, expect, it, vi } from 'vitest';
import { type PanelController, PanelRegistry } from '../../core/panel/index.js';

function makeController() {
	let open = false;
	return {
		open: vi.fn(() => {
			open = true;
		}),
		close: vi.fn(() => {
			open = false;
		}),
		toggle: vi.fn(() => {
			open = !open;
		}),
		focus: vi.fn(async () => {
			//
		}),
		isOpen: vi.fn(() => open),
	} as PanelController & { __getOpen?: () => boolean };
}

describe('PanelRegistry', () => {
	it('registers panels with aliases and resolves case-insensitively', () => {
		const reg = new PanelRegistry();
		const chat = makeController();
		reg.register('chat', chat, ['c', 'ChatBox']);
		expect(reg.get('CHAT')).toBe(chat);
		expect(reg.get('c')).toBe(chat);
		expect(reg.list().some((p) => p.id === 'chat')).toBe(true);
	});

	it('open/close are idempotent based on isOpen()', async () => {
		const reg = new PanelRegistry();
		const chat = makeController();
		reg.register('chat', chat, ['c']);

		// open (was closed)
		await reg.open('chat');
		expect(chat.open).toHaveBeenCalledTimes(1);
		expect(reg.isOpen('chat')).toBe(true);

		// open again (idempotent)
		await reg.open('CHAT');
		expect(chat.open).toHaveBeenCalledTimes(1);

		// close (was open)
		await reg.close('c');
		expect(chat.close).toHaveBeenCalledTimes(1);
		expect(reg.isOpen('chat')).toBe(false);

		// close again (idempotent)
		await reg.close('chat');
		expect(chat.close).toHaveBeenCalledTimes(1);
	});

	it('toggle flips state and focus calls focus()', async () => {
		const reg = new PanelRegistry();
		const p = makeController();
		reg.register('explorer', p, ['x']);

		await reg.toggle('explorer');
		expect(p.toggle).toHaveBeenCalledTimes(1);
		expect(reg.isOpen('explorer')).toBe(true);

		await reg.toggle('X');
		expect(p.toggle).toHaveBeenCalledTimes(2);
		expect(reg.isOpen('explorer')).toBe(false);

		await reg.focus('explorer');
		expect(p.focus).toHaveBeenCalledTimes(1);
	});
});
