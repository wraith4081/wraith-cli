import fs from 'node:fs';
import YAML from 'yaml';

type Plain = Record<string, unknown>;
export interface MigrationAction {
	scope: 'user' | 'project';
	filePath: string;
	backupPath: string;
	notes: string[];
	changed: boolean;
}

function deepReplaceString(
	obj: object | string,
	from: string,
	to: string
): object | string {
	if (obj == null) {
		return obj;
	}
	if (typeof obj === 'string') {
		return obj.replaceAll(from, to);
	}
	if (Array.isArray(obj)) {
		return obj.map((v) => deepReplaceString(v, from, to));
	}
	if (typeof obj === 'object') {
		const o: Plain = {};
		for (const [k, v] of Object.entries(obj)) {
			o[k] = deepReplaceString(v, from, to);
		}
		return o;
	}
	return obj;
}

function detectVersion(cfg: unknown): string | null {
	if (cfg && typeof cfg === 'object' && 'version' in cfg) {
		return String(cfg.version);
	}
	return null;
}

function serializeLike(filePath: string, data: unknown): string {
	if (filePath.endsWith('.json')) {
		return JSON.stringify(data, null, 2);
	}
	return YAML.stringify(data);
}

function writeBackup(filePath: string): string {
	const ts = new Date().toISOString().replace(/[:.]/g, '-');
	const backup = `${filePath}.bak.${ts}`;
	fs.copyFileSync(filePath, backup);
	try {
		if (process.platform !== 'win32') {
			fs.chmodSync(backup, 0o600);
		}
	} catch {
		//
	}
	return backup;
}

export function migrateConfigFile(
	scope: 'user' | 'project',
	filePath: string,
	data: unknown
): MigrationAction {
	const notes: string[] = [];
	let changed = false;
	let cfg = data ?? {};

	const ver = detectVersion(cfg);
	if (ver === null) {
		cfg = { version: '1', ...cfg };
		notes.push("Set version: '1' (was missing)");
		changed = true;
	} else if (ver !== '1') {
		(cfg as { version: string }).version = '1';
		notes.push(`Upgraded version: '${ver}' -> '1'`);
		changed = true;
	}

	const replaced = deepReplaceString(cfg, '.ai-cli', '.wraith');
	if (JSON.stringify(replaced) !== JSON.stringify(cfg)) {
		notes.push("Rewrote legacy '.ai-cli' paths to '.wraith'");
		cfg = replaced;
		changed = true;
	}

	let backupPath = '';
	if (changed && fs.existsSync(filePath)) {
		backupPath = writeBackup(filePath);
		const serialized = serializeLike(filePath, cfg);
		fs.writeFileSync(filePath, serialized, 'utf8');
		try {
			if (process.platform !== 'win32') {
				fs.chmodSync(filePath, 0o600);
			}
		} catch {
			//
		}
	}

	return { scope, filePath, backupPath, notes, changed };
}
