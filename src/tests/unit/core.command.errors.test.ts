import { describe, expect, it } from 'vitest';
import { formatNotFoundMessage } from '../../core/command/errors.js';
import { CommandRegistry } from '../../core/command/index.js';
import { PaletteController } from '../../core/palette/index.js';

describe('Friendly command errors', () => {
	it('suggests closest commands in not-found message', () => {
		const reg = new CommandRegistry();
		reg.register({
			id: 'open',
			handler: () => {
				//
			},
		});
		reg.register({
			id: 'chat',
			handler: () => {
				//
			},
		});
		const msg = formatNotFoundMessage(reg, 'opne');
		expect(msg).toContain('/open');
	});

	it('palette shows friendly not-found with suggestions', async () => {
		const reg = new CommandRegistry();
		reg.register({
			id: 'open',
			args: [{ name: 'route', required: true }],
			handler: () => {
				//
			},
		});
		const pal = new PaletteController(reg);
		await pal.open();
		await pal.setQuery('opne specs');
		await pal.key('Enter');
		expect(pal.getState().lastMessage?.toLowerCase()).toContain(
			'did you mean'
		);
	});
});
