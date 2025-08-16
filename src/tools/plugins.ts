import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ToolPermissionError, ToolValidationError } from '@tools/errors';
import type { ToolRegistry } from '@tools/registry';
import type { ToolContext } from '@tools/types';
import { getProjectWraithDir, getUserWraithDir } from '@util/paths';
import Ajv, { type JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import YAML from 'yaml';

export type PluginSource = 'project' | 'user';

export interface PluginManifestV1 {
	name: string; // unique key; used for precedence (project wins)
	version: string; // manifest version of the plugin package (not CLI)
	description?: string;
	main: string; // relative path to ESM module exporting register()
	homepage?: string;
	permissions?: string[]; // coarse-grained permissions the plugin intends to use
}

export interface LoadedPluginInfo {
	name: string;
	version: string;
	source: PluginSource;
	dir: string;
	main: string;
	description?: string;
	permissions: string[];
	registered: boolean;
	error?: string;
}

const manifestSchema: JSONSchemaType<PluginManifestV1> = {
	type: 'object',
	additionalProperties: false,
	required: ['name', 'version', 'main'],
	properties: {
		name: { type: 'string', minLength: 1 },
		version: { type: 'string', minLength: 1 },
		description: { type: 'string', nullable: true },
		main: { type: 'string', minLength: 1 },
		homepage: { type: 'string', nullable: true },
		permissions: {
			type: 'array',
			items: { type: 'string', minLength: 1 },
			nullable: true,
		},
	},
};

const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
const validateManifest = ajv.compile(manifestSchema);

function readManifestFile(file: string): unknown {
	const raw = fs.readFileSync(file, 'utf8');
	if (file.endsWith('.json')) {
		return JSON.parse(raw) as unknown;
	}
	return YAML.parse(raw) as unknown;
}

function findManifest(dir: string): { path?: string; data?: PluginManifestV1 } {
	const candidates = ['plugin.json', 'plugin.yaml', 'plugin.yml'];
	for (const name of candidates) {
		const file = path.join(dir, name);
		if (!fs.existsSync(file)) {
			continue;
		}
		const data = readManifestFile(file);
		if (!validateManifest(data)) {
			const msg = ajv.errorsText(validateManifest.errors ?? [], {
				separator: '; ',
			});
			throw new ToolValidationError('plugin.manifest', [
				`Invalid ${name} in ${dir}: ${msg}`,
			]);
		}
		return { path: file, data: data as PluginManifestV1 };
	}
	return {};
}

function listPluginDirs(base: string): string[] {
	if (!fs.existsSync(base)) {
		return [];
	}
	const entries = fs.readdirSync(base, { withFileTypes: true });
	const out: string[] = [];
	for (const e of entries) {
		if (e.isDirectory()) {
			out.push(path.join(base, e.name));
		}
	}
	return out;
}

function effAllowedPermissions(policy?: ToolContext['policy']): Set<string> {
	const allow = new Set(policy?.allowPermissions ?? []);
	for (const d of policy?.denyPermissions ?? []) {
		if (allow.has(d)) {
			allow.delete(d);
		}
	}
	return allow;
}

export interface DiscoverPluginsOptions {
	projectPluginsDir?: string; // default: <projectDir>/.wraith/plugins
	userPluginsDir?: string; // default: <home>/.wraith/plugins
	/**
	 * Enforce that plugin "permissions" ⊆ allowedPermissions at load time.
	 * If false, tools are still gated at call time by the registry.
	 * Default: true.
	 */
	enforcePermissions?: boolean;
	/**
	 * Policy used for permission checks (when enforcePermissions=true).
	 * If omitted, treat as "allow none".
	 */
	policy?: ToolContext['policy'];
	/**
	 * Current project dir to resolve default locations.
	 */
	projectDir?: string;
}

/**
 * Discover, load, and register plugins.
 * Project plugins have precedence over user plugins by name.
 */
export async function discoverAndRegisterPlugins(
	reg: ToolRegistry,
	opts: DiscoverPluginsOptions = {}
): Promise<{ loaded: LoadedPluginInfo[] }> {
	const projectDir = opts.projectDir ?? process.cwd();
	const projectPluginsDir =
		opts.projectPluginsDir ??
		path.join(getProjectWraithDir(projectDir), 'plugins');
	const userPluginsDir =
		opts.userPluginsDir ?? path.join(getUserWraithDir(), 'plugins');

	const allowSet = effAllowedPermissions(opts.policy);
	const enforce = opts.enforcePermissions !== false;

	const seen = new Set<string>();
	const loaded: LoadedPluginInfo[] = [];
	async function loadTree(base: string, source: PluginSource) {
		const dirs = listPluginDirs(base);
		for (const dir of dirs) {
			try {
				const { data } = findManifest(dir);
				if (!data) {
					continue;
				}
				if (seen.has(data.name)) {
					continue;
				}

				const mainAbs = path.join(dir, data.main);
				if (!fs.existsSync(mainAbs)) {
					throw new ToolValidationError('plugin.entry', [
						`Missing main entry: ${mainAbs}`,
					]);
				}

				const requested = new Set(data.permissions ?? []);
				if (enforce && requested.size > 0) {
					const lacking = [...requested].filter(
						(p) => !allowSet.has(p)
					);
					if (
						lacking.length > 0 &&
						opts.policy?.onMissingPermission !== 'prompt'
					) {
						// If runtime policy allows prompting, defer enforcement to call-time.
						throw new ToolPermissionError(
							'plugin.load',
							`Plugin "${data.name}" requests denied permissions: ${lacking.join(', ')}`
						);
					}
				}

				const mod: unknown = await import(pathToFileURL(mainAbs).href);
				// biome-ignore lint/suspicious/noExplicitAny: tbd
				const register = (mod as any)?.register;
				if (typeof register !== 'function') {
					throw new ToolValidationError('plugin.entry', [
						`Entry module does not export "register(registry)" in ${mainAbs}`,
					]);
				}
				register(reg);

				loaded.push({
					name: data.name,
					version: data.version,
					source,
					dir,
					main: mainAbs,
					description: data.description,
					permissions: [...requested],
					registered: true,
				});
				seen.add(data.name);
			} catch (e) {
				if (enforce && e instanceof ToolPermissionError) {
					throw e;
				}
				const msg =
					e instanceof Error
						? e.message
						: typeof e === 'string'
							? e
							: 'error';
				loaded.push({
					name: path.basename(dir),
					version: 'unknown',
					source,
					dir,
					main: '',
					permissions: [],
					registered: false,
					error: msg,
				});
			}
		}
	}

	// Precedence: project first, then user (user skipped if name already loaded)
	await loadTree(projectPluginsDir, 'project');
	await loadTree(userPluginsDir, 'user');

	return { loaded };
}
