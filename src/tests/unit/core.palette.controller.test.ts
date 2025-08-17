import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../core/command/index.js';
import { PaletteController } from '../../core/palette/index.js';

function makeRegistry() {
	const reg = new CommandRegistry();
	const executed: string[] = [];
	reg.register({
		id: 'open',
		args: [{ name: 'target', required: true }],
		handler: (argv) => {
			executed.push(['open', ...argv].join(' '));
		},
	});
	reg.register({
		id: 'chat',
		args: [
			{
				name: 'action',
				required: true,
				type: 'enum',
				options: ['open', 'close', 'toggle'],
			},
		],
		handler: (argv) => {
			executed.push(['chat', ...argv].join(' '));
		},
	});
	return { reg, executed } as const;
}

describe('PaletteController', () => {
	it('opens with command suggestions and accepts Tab to complete', async () => {
		const { reg } = makeRegistry();
		const pal = new PaletteController(reg);
		await pal.open();
		await pal.setQuery('op');
		const s = pal.getState();
		expect(s.suggestions.length).toBeGreaterThan(0);
		await pal.key('Tab');
		expect(pal.getState().query.startsWith('open ')).toBe(true);
	});

	it('suggests enum args and executes on Enter; closes by default', async () => {
		const { reg, executed } = makeRegistry();
		const pal = new PaletteController(reg);
		await pal.open();
		await pal.setQuery('chat ');
		const s1 = pal.getState();
		expect(s1.suggestions.map((x) => x.label)).toEqual([
			'open',
			'close',
			'toggle',
		]);
		await pal.key('Tab'); // accept 'open'
		expect(pal.getState().query).toBe('chat open ');
		// remove trailing space for parse correctness and execute
		await pal.setQuery('chat open');
		await pal.key('Enter');
		expect(executed).toContain('chat open');
		expect(pal.getState().open).toBe(false);
	});

	it('can persist after execute when configured', async () => {
		const { reg, executed } = makeRegistry();
		const pal = new PaletteController(reg, { persistOnExecute: true });
		await pal.open();
		await pal.setQuery('open specs');
		await pal.key('Enter');
		expect(executed).toContain('open specs');
		expect(pal.getState().open).toBe(true);
	});
});
