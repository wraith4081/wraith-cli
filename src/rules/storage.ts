import fs from 'node:fs';
import path from 'node:path';
import { type Ruleset, RulesetZ } from '@rules/loader';

import { getProjectWraithDir, getUserWraithDir } from '@util/paths';
import YAML from 'yaml';

export type RulesScope = 'user' | 'project';
export type RulesFormat = 'yaml' | 'json';

const USER_RULE_CANDIDATES = [
	'user-rules.yaml',
	'user-rules.yml',
	'user-rules.json',
] as const;
const PROJECT_RULE_CANDIDATES = [
	'project-rules.yaml',
	'project-rules.yml',
	'project-rules.json',
] as const;

export interface RulesPathInfo {
	path?: string;
	format?: RulesFormat;
}

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(dir, 0o700);
			} catch {
				// best-effort
			}
		}
	}
}

function detectFormatFromPath(filePath: string): RulesFormat {
	return filePath.endsWith('.json') ? 'json' : 'yaml';
}

function readMaybe(filePath: string): unknown | undefined {
	if (!(filePath && fs.existsSync(filePath))) {
		return;
	}
	const raw = fs.readFileSync(filePath, 'utf8');
	if (filePath.endsWith('.json')) {
		return JSON.parse(raw);
	}
	return YAML.parse(raw);
}

function findExistingRulesPath(
	scope: RulesScope,
	baseDir?: string
): RulesPathInfo {
	const base =
		scope === 'user'
			? path.join(baseDir ?? getUserWraithDir())
			: path.join(baseDir ?? getProjectWraithDir());
	const candidates =
		scope === 'user' ? USER_RULE_CANDIDATES : PROJECT_RULE_CANDIDATES;

	for (const f of candidates) {
		const p = path.join(base, f);
		if (fs.existsSync(p)) {
			return { path: p, format: detectFormatFromPath(p) };
		}
	}
	return {};
}

export interface LoadRulesetOptions {
	userDir?: string; // base for ~/.wraith override (tests)
	projectDir?: string; // base for ./.wraith override (tests)
}

export function loadRulesetForScope(
	scope: RulesScope,
	opts: LoadRulesetOptions = {}
): { ruleset: Ruleset; existingPath?: string; formatHint?: RulesFormat } {
	const baseDir = scope === 'user' ? opts.userDir : opts.projectDir;

	const found = findExistingRulesPath(scope, baseDir);
	if (!found.path) {
		return { ruleset: { version: '1', sections: [] } };
	}

	const data = readMaybe(found.path);
	const parsed = RulesetZ.safeParse(data);
	if (!parsed.success) {
		const details = parsed.error.issues
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ');
		throw new Error(
			`Invalid ${scope} rules schema at ${found.path}: ${details}`
		);
	}
	return {
		ruleset: parsed.data,
		existingPath: found.path,
		formatHint: found.format,
	};
}

export interface SaveRulesetOptions {
	format?: RulesFormat; // used when creating a new file
	userDir?: string;
	projectDir?: string;
}

export function saveRulesetForScope(
	scope: RulesScope,
	ruleset: Ruleset,
	opts: SaveRulesetOptions = {}
): { path: string } {
	// If there is an existing file, preserve its format and location
	const { existingPath, formatHint } = loadRulesetForScope(scope, {
		userDir: opts.userDir,
		projectDir: opts.projectDir,
	});
	if (existingPath) {
		const serialized =
			formatHint === 'json'
				? JSON.stringify(ruleset, null, 2)
				: YAML.stringify(ruleset);
		fs.writeFileSync(existingPath, serialized, 'utf8');
		if (process.platform !== 'win32') {
			try {
				fs.chmodSync(existingPath, 0o600);
			} catch {
				//
			}
		}
		return { path: existingPath };
	}

	// Otherwise, create a new file under .wraith with desired format (default yaml)
	const format: RulesFormat = opts.format ?? 'yaml';
	const baseDir =
		scope === 'user'
			? path.join(opts.userDir ?? getUserWraithDir())
			: path.join(opts.projectDir ?? getProjectWraithDir());
	ensureDir(baseDir);
	const fileName = `${scope === 'user' ? 'user' : 'project'}-rules.${format === 'json' ? 'json' : 'yaml'}`;
	const outPath = path.join(baseDir, fileName);

	const serialized =
		format === 'json'
			? JSON.stringify(ruleset, null, 2)
			: YAML.stringify(ruleset);
	fs.writeFileSync(outPath, serialized, 'utf8');
	if (process.platform !== 'win32') {
		try {
			fs.chmodSync(outPath, 0o600);
		} catch {
			//
		}
	}
	return { path: outPath };
}

export function appendRulesToSection(
	ruleset: Ruleset,
	title: string,
	rules: string[]
): Ruleset {
	const cleanRules = rules.map((r) => r.trim()).filter((r) => r.length > 0);
	const idx = ruleset.sections.findIndex((s) => s.title === title);
	if (idx === -1) {
		ruleset.sections.push({ title, rules: cleanRules });
		return ruleset;
	}
	const existing = ruleset.sections[idx];
	existing.rules = (existing.rules ?? []).concat(cleanRules);
	ruleset.sections[idx] = existing;
	return ruleset;
}
