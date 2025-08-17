import { describe, expect, it } from 'vitest';
import { makeEntityArgumentProvider } from '../../core/command/entity-providers.js';
import { CommandRegistry, suggest } from '../../core/command/index.js';

describe('Entity providers for autocomplete', () => {
	it('suggests routes for /open and commands for /help', async () => {
		const reg = new CommandRegistry();
		reg.register({
			id: 'open',
			args: [{ name: 'route', required: true }],
			handler: () => {
				//
			},
		});
		reg.register({
			id: 'help',
			args: [{ name: 'command', required: false }],
			handler: () => {
				//
			},
		});
		const provider = makeEntityArgumentProvider({
			registry: reg,
			routes: () => ['home', 'specs', 'search', 'tasks'],
		});

		const s1 = await suggest('open s', reg, { argumentValues: provider });
		expect(s1[0]?.label).toBe('specs');

		const s2 = await suggest('help o', reg, { argumentValues: provider });
		expect(s2.map((x) => x.label)).toContain('open');
	});

	it('suggests spec names for /spec and task ids for /task', async () => {
		const reg = new CommandRegistry();
		reg.register({
			id: 'spec',
			args: [{ name: 'name', required: true }],
			handler: () => {
				//
			},
		});
		reg.register({
			id: 'task',
			args: [{ name: 'id', required: true }],
			handler: () => {
				//
			},
		});
		const provider = makeEntityArgumentProvider({
			registry: reg,
			specs: () => [
				'chat-command-palette-and-keyboard-nav',
				'ingest-pipeline',
			],
			tasks: () => ['1.1', '2.3', '10.2'],
		});

		const s1 = await suggest('spec c', reg, { argumentValues: provider });
		expect(s1.map((x) => x.label)[0]).toContain('chat-command');

		const s2 = await suggest('task 1', reg, { argumentValues: provider });
		expect(s2.map((x) => x.label)).toContain('1.1');
	});
});
