/** biome-ignore-all lint/suspicious/noConsole: tbd */

import { getModelCatalog } from '@models/registry';
import { loadConfig } from '@store/config';
import type { Command } from 'commander';

export function registerModelsCommand(program: Command) {
	const modelsCmd = program
		.command('models')
		.description('Model catalog commands');

	modelsCmd
		.command('list')
		.description(
			'List models from the local catalog (built-in + config overrides)'
		)
		.option('--json', 'Output JSON')
		.action((opts: { json?: boolean }) => {
			const { merged } = loadConfig();
			const catalog = getModelCatalog(merged);

			if (opts?.json) {
				console.log(JSON.stringify({ models: catalog }, null, 2));
				return;
			}

			if (catalog.length === 0) {
				console.log(
					'No models in catalog. Use "ai configure" or add models to config.'
				);
				return;
			}

			console.log('Models:');
			for (const m of catalog) {
				const parts = [
					`- ${m.key}`,
					`(id: ${m.id})`,
					m.label ? `— ${m.label}` : '',
					m.contextLength ? `ctx: ${m.contextLength}` : '',
					m.modalities?.length
						? `modalities: ${m.modalities.join(',')}`
						: '',
					m.aliases?.length ? `aliases: ${m.aliases.join(',')}` : '',
				].filter(Boolean);
				console.log(parts.join(' '));
			}
		});
}
