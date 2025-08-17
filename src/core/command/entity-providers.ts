import type { PanelRegistry } from '../panel/registry.js';
import type { ArgumentValuesProvider } from './autocomplete.js';
import type { CommandRegistry } from './registry.js';

export interface EntityProviderOptions {
	registry: CommandRegistry;
	panels?: PanelRegistry;
	routes?: () => Promise<string[]> | string[];
	specs?: () => Promise<string[]> | string[];
	tasks?: () => Promise<string[]> | string[];
}

export function makeEntityArgumentProvider(
	opts: EntityProviderOptions
): ArgumentValuesProvider {
	const listRoutes = async () => (await opts.routes?.()) ?? [];
	const listSpecs = async () => (await opts.specs?.()) ?? [];
	const listTasks = async () => (await opts.tasks?.()) ?? [];
	const listCommands = () => opts.registry.list().map((c) => c.id);

	return ({ command, argIndex }) => {
		const id = command.id;
		if ((id === 'open' || id === 'goto' || id === 'go') && argIndex === 0) {
			return listRoutes();
		}
		if (id === 'help' && argIndex === 0) {
			return listCommands();
		}
		if (id === 'spec' && argIndex === 0) {
			return listSpecs();
		}
		if (id === 'task' && argIndex === 0) {
			return listTasks();
		}
		return [];
	};
}
