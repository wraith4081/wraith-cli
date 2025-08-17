import type { PanelRegistry } from '../panel/registry.js';
import type { CommandRegistry, CommandSpec } from './index.js';

type Ctx = unknown;

const ACTIONS = ['open', 'close', 'toggle'] as const;
type Action = (typeof ACTIONS)[number];

function makeHandler(panels: PanelRegistry, panelId: string) {
	return async ([action]: string[]) => {
		const a = (action as Action) ?? 'open';
		switch (a) {
			case 'open': {
				const was = panels.isOpen(panelId);
				await panels.open(panelId);
				return was ? 'already open' : 'opened';
			}
			case 'close': {
				const was = panels.isOpen(panelId);
				await panels.close(panelId);
				return was ? 'closed' : 'already closed';
			}
			case 'toggle': {
				await panels.toggle(panelId);
				return panels.isOpen(panelId) ? 'opened' : 'closed';
			}
			default:
				throw new Error(`Unknown action '${action}'`);
		}
	};
}

export function registerDirectPanelCommands(
	registry: CommandRegistry<Ctx, unknown>,
	panels: PanelRegistry
) {
	for (const { id, aliases } of panels.list()) {
		const spec: CommandSpec<Ctx, unknown> = {
			id,
			aliases,
			synopsis: `Control '${id}' panel`,
			args: [
				{
					name: 'action',
					required: true,
					type: 'enum',
					options: [...ACTIONS],
				},
			],
			handler: makeHandler(panels, id),
		};
		registry.register(spec);
	}
}
