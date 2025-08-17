import { describe, expect, it } from 'vitest';
import {
	type AutocompleteOptions,
	CommandRegistry,
	suggest,
} from '../../core/command/index.js';

function makeRegistry() {
	const reg = new CommandRegistry();
	reg.register({
		id: 'open',
		synopsis: 'Open a page/route',
		args: [{ name: 'target', required: true }],
		handler: () => {
			//
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
		handler: () => {
			//
		},
	});
	reg.register({
		id: 'panel',
		aliases: ['p'],
		args: [
			{
				name: 'action',
				required: true,
				type: 'enum',
				options: ['open', 'close', 'toggle'],
			},
			{ name: 'name', required: true },
		],
		handler: () => {
			//
		},
	});
	return reg;
}

describe('Autocomplete Engine', () => {
	it('suggests commands when typing id (prefix and fuzzy)', async () => {
		const reg = makeRegistry();
		const s1 = await suggest('/o', reg);
		expect(s1[0]?.label).toBe('open');
		const s2 = await suggest('p', reg);
		// alias and id both show up; ensure we see panel/p at top
		expect(s2.some((s) => s.label === 'panel' || s.label === 'p')).toBe(
			true
		);
	});

	it('switches to argument suggestions after first space', async () => {
		const reg = makeRegistry();
		const opts: AutocompleteOptions = {
			argumentValues: ({ command, argIndex }) => {
				if (command.id === 'open' && argIndex === 0) {
					return ['specs', 'tasks', 'search', 'output'];
				}
				return [];
			},
		};

		const s1 = await suggest('open ', reg, opts);
		expect(s1.map((x) => x.label)).toContain('specs');

		const s2 = await suggest('open s', reg, opts);
		expect(s2[0]?.label).toBe('specs');
	});

	it('suggests enum options for command arguments', async () => {
		const reg = makeRegistry();
		const s1 = await suggest('/chat ', reg);
		expect(s1.map((x) => x.label)).toEqual(['open', 'close', 'toggle']);

		const s2 = await suggest('/panel to', reg);
		expect(s2[0]?.label).toBe('toggle');
	});
});
