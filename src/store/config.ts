import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

export type ConfigUnknown = Record<string, unknown>;

const CONFIG_FILENAMES = ['config.yaml', 'config.yml', 'config.json'];

export interface LoadResult {
	userPath?: string;
	projectPath?: string;
	merged: ConfigUnknown;
	user?: ConfigUnknown;
	project?: ConfigUnknown;
}

export function getUserWraithDir(): string {
	return path.join(os.homedir(), '.wraith');
}

export function getProjectWraithDir(cwd = process.cwd()): string {
	return path.join(cwd, '.wraith');
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		// On Unix, secure directory perms (rwx for user only)
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dir, 0o700);
			} catch {
				// best-effort; ignore
			}
		}
	}
}

function readMaybe(filePath: string): ConfigUnknown | undefined {
	if (!fs.existsSync(filePath)) {
		return;
	}
	const raw = fs.readFileSync(filePath, 'utf8');
	if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
		return YAML.parse(raw) ?? {};
	}
	if (filePath.endsWith('.json')) {
		return JSON.parse(raw) as ConfigUnknown;
	}
	return;
}

function findFirstExisting(baseDir: string): {
	path?: string;
	data?: ConfigUnknown;
} {
	for (const name of CONFIG_FILENAMES) {
		const p = path.join(baseDir, name);
		const data = readMaybe(p);
		if (data) {
			return { path: p, data };
		}
	}
	return {};
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
	return !!x && typeof x === 'object' && !Array.isArray(x);
}

// rhs overrides lhs; arrays replaced by rhs; plain objects merged recursively.
function deepMerge<T extends Record<string, unknown>>(lhs: T, rhs: T): T {
	const out: Record<string, unknown> = { ...lhs };
	for (const [k, v] of Object.entries(rhs)) {
		const lv = out[k];
		if (isPlainObject(lv) && isPlainObject(v)) {
			out[k] = deepMerge(
				lv as Record<string, unknown>,
				v as Record<string, unknown>
			);
		} else {
			out[k] = v;
		}
	}
	return out as T;
}

export function loadConfig(cwd = process.cwd()): LoadResult {
	const userDir = getUserWraithDir();
	const projectDir = getProjectWraithDir(cwd);

	const { path: userPath, data: user } = findFirstExisting(userDir);
	const { path: projectPath, data: project } = findFirstExisting(projectDir);

	let merged: ConfigUnknown = {};
	if (user) {
		merged = deepMerge(merged, user);
	}
	if (project) {
		merged = deepMerge(merged, project);
	}

	return { userPath, projectPath, merged, user, project };
}

export function saveConfig(
	scope: 'user' | 'project',
	data: ConfigUnknown,
	opts?: { format?: 'yaml' | 'json'; cwd?: string }
): { path: string } {
	const format = opts?.format ?? 'yaml';
	const dir =
		scope === 'user'
			? getUserWraithDir()
			: getProjectWraithDir(opts?.cwd ?? process.cwd());
	ensureDir(dir);
	const file = path.join(
		dir,
		format === 'yaml' ? 'config.yaml' : 'config.json'
	);
	const serialized =
		format === 'yaml'
			? YAML.stringify(data)
			: JSON.stringify(data, null, 2);
	fs.writeFileSync(file, serialized, { encoding: 'utf8' });
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(file, 0o600);
		} catch {
			// best-effort; ignore
		}
	}
	return { path: file };
}
