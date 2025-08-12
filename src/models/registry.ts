import { getLogger } from '@obs/logger';
import type { ModelInfo } from '@provider/types';
import {
	type ConfigV1,
	ConfigV1Z,
	type ModelsConfig,
	ModelsConfigZ,
} from '@store/schema';

export interface CatalogModel extends ModelInfo {
	key: string;
	label?: string;
	aliases?: string[];
}

const BUILTIN: Record<string, Omit<CatalogModel, 'key' | 'aliases'>> = {
	'gpt-5': {
		id: 'gpt-5',
		label: 'GPT-5 (OpenAI)',
		contextLength: 131_072,
		modalities: ['text'],
	},
};

function isValidConfig(cfg: unknown): cfg is ConfigV1 {
	return ConfigV1Z.safeParse(cfg).success;
}

function getModelsConfig(cfg?: ConfigV1): ModelsConfig | undefined {
	if (!cfg || typeof cfg !== 'object') {
		return;
	}
	const parsed = ModelsConfigZ.safeParse((cfg as ConfigV1)?.models);
	return parsed.success ? parsed.data : undefined;
}

export function getModelCatalog(cfgUnknown?: unknown): CatalogModel[] {
	const log = getLogger();
	const cfg = isValidConfig(cfgUnknown)
		? (cfgUnknown as ConfigV1)
		: undefined;
	const modelsCfg = getModelsConfig(cfg);

	const map = new Map<string, CatalogModel>();
	for (const [key, value] of Object.entries(BUILTIN)) {
		map.set(key, { key, aliases: [], ...value });
	}

	if (modelsCfg?.catalog) {
		for (const [key, entry] of Object.entries(modelsCfg.catalog)) {
			map.set(key, {
				key,
				id: entry.id,
				label: entry.label,
				contextLength: entry.contextLength ?? null,
				modalities: entry.modalities ?? ['text'],
				aliases: [],
			});
		}
	}

	if (modelsCfg?.aliases) {
		for (const [alias, target] of Object.entries(modelsCfg.aliases)) {
			let targetKey: string | undefined;

			if (map.has(target)) {
				targetKey = target;
			} else {
				for (const [k, val] of map.entries()) {
					if (val.id === target) {
						targetKey = k;
						break;
					}
				}
			}

			if (targetKey) {
				const model = map.get(targetKey);
				if (model) {
					model.aliases = model.aliases
						? [...model.aliases, alias]
						: [alias];
					map.set(targetKey, model);
				}
			} else {
				log.error({
					msg: 'invalid-model-alias',
					path: `models.aliases.${alias}`,
					error: `Alias target "${target}" not found in catalog or provider id`,
				});
			}
		}
	}

	return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function resolveModelId(
	idOrAlias: string,
	cfgUnknown?: unknown
):
	| {
			id: string;
			key?: string;
			info?: CatalogModel;
	  }
	| undefined {
	const catalog = getModelCatalog(cfgUnknown);
	const direct = catalog.find((m) => m.key === idOrAlias);
	if (direct) {
		return { id: direct.id, key: direct.key, info: direct };
	}

	const aliased = catalog.find((m) => m.aliases?.includes(idOrAlias));
	if (aliased) {
		return { id: aliased.id, key: aliased.key, info: aliased };
	}

	const byId = catalog.find((m) => m.id === idOrAlias);
	if (byId) {
		return { id: byId.id, key: byId.key, info: byId };
	}

	return;
}
