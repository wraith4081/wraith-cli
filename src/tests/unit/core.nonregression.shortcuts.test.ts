import { describe, expect, it } from 'vitest';
import { HotkeyManager } from '../../core/hotkeys/index.js';
import { PanelRegistry } from '../../core/panel/index.js';

function makeController() {
	let open = false;
	return {
		open: () => {
			open = true;
		},
		close: () => {
			open = false;
		},
		toggle: () => {
			open = !open;
		},
		focus: async () => {
			//
		},
		isOpen: () => open,
	};
}

describe('Non-regression for existing shortcuts', () => {
	it('existing mappings remain until explicitly remapped', async () => {
		const hk = new HotkeyManager('win32');
		let paletteOpens = 0;
		hk.register('palette.open', 'Mod+K', () => {
			paletteOpens++;
		}); // Ctrl+K on Windows

		// initial mapping fires
		await hk.handle({ key: 'k', ctrlKey: true });
		expect(paletteOpens).toBe(1);

		// remap; old should not fire, new should
		hk.remap('palette.open', 'Ctrl+P');
		await hk.handle({ key: 'k', ctrlKey: true });
		expect(paletteOpens).toBe(1);
		await hk.handle({ key: 'p', ctrlKey: true });
		expect(paletteOpens).toBe(2);
	});

	it('panel toggle hotkey does not conflict and controls panel state', async () => {
		const hk = new HotkeyManager('win32');
		const panels = new PanelRegistry();
		const chat = makeController();
		panels.register('chat', chat, ['c']);

		hk.register('panel.chat.toggle', 'Ctrl+Shift+C', async () => {
			await panels.toggle('chat');
		});

		// unrelated key: no change
		await hk.handle({ key: 'k', ctrlKey: true });
		expect(panels.isOpen('chat')).toBe(false);

		// toggle opens
		await hk.handle({ key: 'c', ctrlKey: true, shiftKey: true });
		expect(panels.isOpen('chat')).toBe(true);

		// toggle closes
		await hk.handle({ key: 'c', ctrlKey: true, shiftKey: true });
		expect(panels.isOpen('chat')).toBe(false);
	});
});
