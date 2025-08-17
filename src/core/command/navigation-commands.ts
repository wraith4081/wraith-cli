import { navigateTo } from '../navigation/navigation.js';
import type { RouterAPI } from '../navigation/types.js';
import type { CommandRegistry, CommandSpec } from './index.js';

type Ctx = unknown;

export function registerNavigationCommands(
	registry: CommandRegistry<Ctx, unknown>,
	router: RouterAPI
) {
	const openSpec: CommandSpec<Ctx, string> = {
		id: 'open',
		aliases: ['goto', 'go'],
		synopsis: 'Open a page/route',
		args: [{ name: 'route', required: true }],
		handler: ([route]) => {
			const res = navigateTo(router, route);
			if (res.status === 'ok') {
				return 'ok';
			}
			if (res.status === 'already-open') {
				return 'already open';
			}
			throw new Error(res.message || 'route not found');
		},
	};

	const helpSpec: CommandSpec<Ctx, string> = {
		id: 'help',
		synopsis: 'Show available commands or details for a command',
		args: [{ name: 'command', required: false }],
		handler: ([idOrAlias]) => {
			if (!idOrAlias) {
				// list commands with synopsis
				const lines = registry
					.list()
					.map(
						(cr) =>
							`/${cr.id}${cr.aliases?.length ? ` (${cr.aliases.join(', ')})` : ''}${cr.synopsis ? ` - ${cr.synopsis}` : ''}`
					)
					.sort();
				return lines.join('\n');
			}
			const c = registry.get(idOrAlias);
			if (!c) {
				return `Command '${idOrAlias}' not found`;
			}
			const args = (c.args ?? [])
				.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`))
				.join(' ');
			const aliases = c.aliases?.length
				? ` (aliases: ${c.aliases.join(', ')})`
				: '';
			return `/${c.id} ${args}${aliases}${c?.synopsis ? `\n${c.synopsis}` : ''}`.trim();
		},
	};

	registry.register(openSpec);
	registry.register(helpSpec);
}
