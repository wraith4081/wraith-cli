import { describe, expect, it, vi } from 'vitest';
import {
	CommandRegistry,
	registerDirectPanelCommands,
} from '../../core/command/index.js';
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
	} as PanelController;
}

describe('Direct panel commands', () => {
	it('registers one command per panel id with aliases and controls panel state', async () => {
		const panels = new PanelRegistry();
		const chat = makeController();
		const explorer = makeController();
		panels.register('chat', chat, ['c']);
		panels.register('explorer', explorer, ['x']);

		const reg = new CommandRegistry();
		registerDirectPanelCommands(reg, panels);

		// chat open
		await reg.execute('chat', ['open'], {});
		expect(chat.open).toHaveBeenCalledTimes(1);
		expect(panels.isOpen('chat')).toBe(true);

		// explorer toggle via alias after open -> should close
		await reg.execute('x', ['toggle'], {});
		expect(explorer.toggle).toHaveBeenCalledTimes(1);

		// idempotent: opening chat again returns already open and does not call open again
		const msg = await reg.execute('chat', ['open'], {});
		expect(chat.open).toHaveBeenCalledTimes(1);
		expect(typeof msg === 'string').toBe(true);
	});
});
